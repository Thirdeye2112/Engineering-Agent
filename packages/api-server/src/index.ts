import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, projects, subtasks, permissionRequests } from '@consensus/db';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { projectMemory } from '@consensus/memory';
import { permissionEngine } from '@consensus/permissions';
import { conversationStore } from '@consensus/agent-manager';
import { createProvider } from '@consensus/agent-manager';
import { DebateEngine } from '@consensus/agent-manager';
import { TaskDecomposer } from '@consensus/agent-manager';
import { CollaborationOrchestrator } from '@consensus/agent-manager';
import { IntegrationEngine } from '@consensus/agent-manager';
import { PRWorkflow } from '@consensus/agent-manager';
import { onboardingWorkflow } from '@consensus/agent-manager';
import { CreateProjectRequestSchema } from '@consensus/shared-types';
import { auditEvents } from '@consensus/db';
import { and, inArray, sql, desc } from 'drizzle-orm';
import { auditLog } from '@consensus/audit-log';

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const wsClients = new Map<string, Set<WebSocket>>();

function broadcast(projectId: string, event: unknown) {
  const clients = wsClients.get(projectId);
  if (!clients) return;
  const msg = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  const projectId = new URL(req.url ?? '/', `http://localhost`).searchParams.get('projectId');
  if (!projectId) { ws.close(); return; }
  if (!wsClients.has(projectId)) wsClients.set(projectId, new Set());
  wsClients.get(projectId)!.add(ws);
  ws.on('close', () => wsClients.get(projectId)?.delete(ws));
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/projects', async (req, res) => {
  const parsed = CreateProjectRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const projectReq = parsed.data;
  const projectId = uuidv4();

  const db = getDb();
  await db.insert(projects).values({
    id: projectId,
    task: projectReq.task,
    mode: projectReq.mode,
    status: 'running',
    config: projectReq as any,
  });

  res.status(202).json({ projectId, status: 'running' });

  await auditLog.append({
    projectId,
    actorType: 'user',
    actionType: 'project_created',
    inputSummary: `mode=${projectReq.mode} agents=${projectReq.agents.length} task=${projectReq.task.slice(0, 100)}`,
    approvalStatus: 'not_required',
  }).catch(() => {});

  // Run in background
  (async () => {
    try {
      if (projectReq.mode === 'debate') {
        const agentConfigs = projectReq.agents.map(a => ({
          provider: createProvider(a.provider, a.tier),
          role: a.role,
        }));

        const engine = new DebateEngine({
          deliberationId: projectId,
          task: projectReq.task,
          agents: agentConfigs,
          maxRounds: projectReq.maxRounds,
          budgetCap: projectReq.budgetCap,
          onEvent: (event) => broadcast(projectId, event),
        });

        const report = await engine.run();

        await db.update(projects)
          .set({ status: 'complete', report: report as any, completedAt: new Date() })
          .where(eq(projects.id, projectId));

      } else if (projectReq.mode === 'collaborate') {
        // Collaboration mode
        const primaryAgent = projectReq.agents[0];
        const provider = createProvider(primaryAgent.provider, primaryAgent.tier);

        const decomposer = new TaskDecomposer(provider);
        const availableRoles = projectReq.agents.map(a => a.role);
        const subtaskList = await decomposer.decompose(projectReq.task, availableRoles);

        await db.insert(subtasks).values(subtaskList.map(s => ({
          id: s.id,
          projectId,
          description: s.description,
          assignedRole: s.assignedRole,
          wave: s.wave,
          dependencies: s.dependencies,
          status: 'pending',
        })));

        const orchestrator = new CollaborationOrchestrator(projectId, provider);
        const results = await orchestrator.run(subtaskList);

        const integrator = new IntegrationEngine(provider, projectId);
        const integratedDocument = await integrator.integrate(projectReq.task, results);

        const report = {
          projectId,
          task: projectReq.task,
          subtasks: subtaskList,
          results,
          integratedDocument,
          completedAt: new Date().toISOString(),
        };

        await db.update(projects)
          .set({ status: 'complete', report: report as any, completedAt: new Date() })
          .where(eq(projects.id, projectId));

        broadcast(projectId, { type: 'deliberation_complete', report });

      } else if (projectReq.mode === 'pr_workflow') {
        const agentConfigs = projectReq.agents.map(a => ({
          provider: createProvider(a.provider, a.tier),
          role: a.role,
        }));

        const workflow = new PRWorkflow({
          projectId,
          task: projectReq.task,
          agents: agentConfigs,
          sandboxRoot: process.env.FILESYSTEM_SANDBOX_ROOT,
          onEvent: (event) => broadcast(projectId, event),
        });

        const report = await workflow.run();

        await db.update(projects)
          .set({ status: 'complete', report: report as any, completedAt: new Date() })
          .where(eq(projects.id, projectId));
      }
    } catch (err) {
      console.error('[Project error]', err);
      await getDb().update(projects)
        .set({ status: 'error' })
        .where(eq(projects.id, projectId));
      await auditLog.append({
        projectId,
        actorType: 'system',
        actionType: 'project_error',
        outputSummary: String(err).slice(0, 300),
        approvalStatus: 'not_required',
      }).catch(() => {});
    }
  })();
});

app.get('/projects', async (_req, res) => {
  const db = getDb();
  const rows = await db.select().from(projects).orderBy(projects.createdAt);
  res.json(rows);
});

app.get('/projects/:id', async (req, res) => {
  const db = getDb();
  const rows = await db.select().from(projects).where(eq(projects.id, req.params.id));
  if (rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(rows[0]);
});

app.get('/projects/:id/subtasks', async (req, res) => {
  const db = getDb();
  const rows = await db.select().from(subtasks).where(eq(subtasks.projectId, req.params.id));
  res.json(rows);
});

app.post('/projects/:id/override', async (req, res) => {
  const db = getDb();
  await db.update(projects)
    .set({ status: req.body.status ?? 'complete' })
    .where(eq(projects.id, req.params.id));
  res.json({ ok: true });
});

// Audit log endpoints
app.get('/projects/:id/audit-events', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string ?? '100'), 500);
  const events = await auditLog.getEvents(req.params.id, limit);
  res.json(events);
});

app.get('/audit/verify', async (req, res) => {
  const projectId = req.query.projectId as string | undefined;
  const result = await auditLog.verify(projectId);
  res.json(result);
});

// Approval queue — pending permission requests across all projects
app.get('/approvals/pending', async (_req, res) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(permissionRequests)
    .where(eq(permissionRequests.status, 'pending'))
    .orderBy(permissionRequests.createdAt);
  res.json(rows);
});

app.post('/approvals/:id/approve', async (req, res) => {
  const { id } = req.params;
  const reviewedBy = req.body.reviewedBy ?? 'human';
  await permissionEngine.resolveRequest(id, 'approved', reviewedBy);
  const request = await permissionEngine.getRequest(id);
  if (request) broadcast(request.projectId, { type: 'permission_approved', requestId: id });
  await auditLog.append({
    projectId: request?.projectId,
    actorType: 'user',
    actorId: reviewedBy,
    actionType: 'approval.granted',
    inputSummary: `requestId=${id}`,
    approvalStatus: 'approved',
  }).catch(() => {});
  res.json({ ok: true });
});

app.post('/approvals/:id/deny', async (req, res) => {
  const { id } = req.params;
  const reviewedBy = req.body.reviewedBy ?? 'human';
  await permissionEngine.resolveRequest(id, 'denied', reviewedBy);
  const request = await permissionEngine.getRequest(id);
  if (request) broadcast(request.projectId, { type: 'permission_denied', requestId: id });
  await auditLog.append({
    projectId: request?.projectId,
    actorType: 'user',
    actorId: reviewedBy,
    actionType: 'approval.denied',
    inputSummary: `requestId=${id}`,
    approvalStatus: 'denied',
  }).catch(() => {});
  res.json({ ok: true });
});

// Project workflow report (PR mode)
app.get('/projects/:id/workflow-report', async (req, res) => {
  const db = getDb();
  const rows = await db.select().from(projects).where(eq(projects.id, req.params.id));
  if (rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
  const project = rows[0];
  if (!project.report) { res.status(404).json({ error: 'No report available' }); return; }
  res.json(project.report);
});

// Project memories
app.get('/projects/:id/memories', async (req, res) => {
  const memories = await projectMemory.retrieve({
    projectId: req.params.id,
    includeExpired: req.query.includeExpired === 'true',
    includeSuperseded: req.query.includeSuperseded === 'true',
    limit: Math.min(parseInt((req.query.limit as string) ?? '100'), 500),
  });
  res.json(memories);
});

// Permission approval flow
app.get('/projects/:id/permission-requests', async (req, res) => {
  const db = getDb();
  const rows = await db.select().from(permissionRequests).where(eq(permissionRequests.projectId, req.params.id));
  res.json(rows);
});

app.post('/permission-requests/:requestId/approve', async (req, res) => {
  const { requestId } = req.params;
  const reviewedBy = req.body.reviewedBy ?? 'human';
  await permissionEngine.resolveRequest(requestId, 'approved', reviewedBy);
  const request = await permissionEngine.getRequest(requestId);
  if (request) broadcast(request.projectId, { type: 'permission_approved', requestId });
  res.json({ ok: true });
});

app.post('/permission-requests/:requestId/deny', async (req, res) => {
  const { requestId } = req.params;
  const reviewedBy = req.body.reviewedBy ?? 'human';
  await permissionEngine.resolveRequest(requestId, 'denied', reviewedBy);
  const request = await permissionEngine.getRequest(requestId);
  if (request) broadcast(request.projectId, { type: 'permission_denied', requestId });
  res.json({ ok: true });
});

// Approval telemetry / reputation metrics
app.get('/metrics/approvals', async (req, res) => {
  const db = getDb();
  const projectId = req.query.projectId as string | undefined;

  const conditions = [
    inArray(auditEvents.approvalStatus, ['approved', 'denied', 'not_required']),
  ];
  if (projectId) conditions.push(eq(auditEvents.projectId, projectId));

  const rows = await db
    .select({
      agentRole: auditEvents.actorId,
      toolName: auditEvents.toolName,
      approvalStatus: auditEvents.approvalStatus,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(auditEvents)
    .where(and(...conditions))
    .groupBy(auditEvents.actorId, auditEvents.toolName, auditEvents.approvalStatus)
    .orderBy(desc(sql`count(*)`));

  // Aggregate into per-agent-role rows
  const byAgent = new Map<string, { approved: number; denied: number; autoAllowed: number }>();
  for (const row of rows) {
    const key = row.agentRole ?? 'system';
    const entry = byAgent.get(key) ?? { approved: 0, denied: 0, autoAllowed: 0 };
    if (row.approvalStatus === 'approved') entry.approved += row.count;
    else if (row.approvalStatus === 'denied') entry.denied += row.count;
    else if (row.approvalStatus === 'not_required') entry.autoAllowed += row.count;
    byAgent.set(key, entry);
  }

  const metricRows = Array.from(byAgent.entries()).map(([agentRole, c]) => {
    const total = c.approved + c.denied + c.autoAllowed;
    const humanDecisions = c.approved + c.denied;
    const approvalRate = humanDecisions > 0 ? c.approved / humanDecisions : 1;
    return { agentRole, approved: c.approved, denied: c.denied, autoAllowed: c.autoAllowed, total, approvalRate };
  });

  const totalDecisions = metricRows.reduce((s, r) => s + r.approved + r.denied, 0);
  const totalApproved = metricRows.reduce((s, r) => s + r.approved, 0);
  const globalApprovalRate = totalDecisions > 0 ? totalApproved / totalDecisions : 1;
  const HIGH_TRUST = 0.9;
  const highTrustAgents = metricRows
    .filter(r => r.approvalRate >= HIGH_TRUST && r.approved + r.denied >= 10)
    .map(r => r.agentRole ?? 'unknown');

  res.json({ rows: metricRows, globalApprovalRate, totalDecisions, highTrustAgents });
});

// Repository onboarding
app.post('/projects/:id/onboard', async (req, res) => {
  const sandboxRoot = req.body.sandboxRoot ?? process.env.FILESYSTEM_SANDBOX_ROOT;
  if (!sandboxRoot) {
    res.status(400).json({ error: 'sandboxRoot required (or set FILESYSTEM_SANDBOX_ROOT)' });
    return;
  }
  try {
    const report = await onboardingWorkflow.run({
      projectId: req.params.id,
      repoFullName: req.body.repoFullName,
      sandboxRoot,
    });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Allow frontend to update runtime API keys (local dev only)
const ALLOWED_ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'GITHUB_TOKEN', 'FILESYSTEM_SANDBOX_ROOT'];
app.post('/credentials', (req, res) => {
  for (const [k, v] of Object.entries(req.body)) {
    if (ALLOWED_ENV_KEYS.includes(k) && typeof v === 'string' && v.length > 4) {
      process.env[k] = v;
    }
  }
  res.json({ ok: true });
});

// Dashboard: recent audit events
app.get('/audit', async (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string ?? '20', 10), 100);
    const rows = await db.select().from(auditEvents).orderBy(desc(auditEvents.seq)).limit(limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Dashboard: list projects (optionally filter by status)
app.get('/projects', async (req, res) => {
  try {
    const db = getDb();
    const { eq } = await import('drizzle-orm');
    const status = req.query.status as string | undefined;
    const rows = status
      ? await db.select().from(projects).where(eq(projects.status, status))
      : await db.select().from(projects).orderBy(desc(projects.createdAt)).limit(50);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function start() {
  // Wire permission approval broadcast into the permission engine
  permissionEngine.onApprovalRequest = (projectId, requestId, detail) => {
    broadcast(projectId, { type: 'permission_requested', requestId, detail });
  };

  await conversationStore.connect();
  console.log('[Consensus AI] Redis connected');

  httpServer.listen(PORT, () => {
    console.log(`[Consensus AI] Ready on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('[Consensus AI] Startup failed:', err);
  process.exit(1);
});

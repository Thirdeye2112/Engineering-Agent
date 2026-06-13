import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { getDb, projects, subtasks, permissionRequests } from '@consensus/db';
import { permissionEngine } from '@consensus/permissions';
import { conversationStore } from '@consensus/agent-manager';
import { createProvider } from '@consensus/agent-manager';
import { DebateEngine } from '@consensus/agent-manager';
import { TaskDecomposer } from '@consensus/agent-manager';
import { CollaborationOrchestrator } from '@consensus/agent-manager';
import { IntegrationEngine } from '@consensus/agent-manager';
import { CreateProjectRequestSchema } from '@consensus/shared-types';
import { eq } from 'drizzle-orm';

const app = express();
app.use(express.json());

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

      } else {
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
      }
    } catch (err) {
      console.error('[Project error]', err);
      await getDb().update(projects)
        .set({ status: 'error' })
        .where(eq(projects.id, projectId));
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

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function start() {
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

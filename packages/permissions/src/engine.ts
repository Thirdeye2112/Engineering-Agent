import { getDb } from '@consensus/db';
import { permissionRules, permissionRequests } from './schema.js';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { AgentRole } from '@consensus/shared-types';
import { v4 as uuidv4 } from 'uuid';
import { auditLog } from '@consensus/audit-log';

export interface PermissionRule {
  agentRole: AgentRole | '*';
  tool: string | '*';
  operations: string[] | '*';
  level: 'read' | 'write' | 'admin';
  conditions?: {
    maxFileSizeBytes?: number;
    allowedPaths?: string[];
    allowedBranches?: string[];
    allowedCommands?: string[];
  };
}

export interface ProjectPermissions {
  projectId: string;
  rules: PermissionRule[];
  defaultDeny: boolean;
}

export class PermissionEngine {
  // Injected by api-server so WS broadcast happens without circular deps
  onApprovalRequest?: (projectId: string, requestId: string, detail: unknown) => void;

  async check(
    agentRole: AgentRole,
    tool: string,
    operation: string,
    context: { projectId: string; input: unknown },
  ): Promise<{ allowed: boolean; reason: string }> {
    const db = getDb();
    const rules = await db
      .select()
      .from(permissionRules)
      .where(eq(permissionRules.projectId, context.projectId));

    for (const rule of rules) {
      const roleMatch = rule.agentRole === '*' || rule.agentRole === agentRole;
      const toolMatch = rule.tool === '*' || rule.tool === tool;
      const ops = rule.operations as string[] | '*';
      const opMatch = ops === '*' || (Array.isArray(ops) && ops.includes(operation));

      if (roleMatch && toolMatch && opMatch) {
        return { allowed: true, reason: `Matched rule id=${rule.id}` };
      }
    }

    return { allowed: false, reason: `No rule permits ${agentRole} to use ${tool}.${operation} on project ${context.projectId}` };
  }

  async requestApproval(
    agentRole: AgentRole,
    tool: string,
    operation: string,
    rationale: string,
    projectId: string,
    toolInput?: unknown,
  ): Promise<{ requestId: string }> {
    const db = getDb();
    const id = uuidv4();
    const toolInputHash = toolInput !== undefined
      ? createHash('sha256').update(JSON.stringify(toolInput)).digest('hex')
      : null;
    await db.insert(permissionRequests).values({
      id,
      projectId,
      agentRole,
      tool,
      operation,
      rationale,
      status: 'pending',
      toolInputHash,
      consumed: false,
    });
    this.onApprovalRequest?.(projectId, id, { agentRole, tool, operation, rationale });

    await auditLog.append({
      projectId,
      actorType: 'agent',
      actorId: agentRole,
      actionType: 'permission_requested',
      toolName: tool,
      inputSummary: `${operation} — ${rationale.slice(0, 200)}`,
      approvalStatus: 'pending',
    }).catch(err => console.warn('[audit] permission_requested:', err));

    return { requestId: id };
  }

  async resolveRequest(
    requestId: string,
    decision: 'approved' | 'denied',
    reviewedBy: string,
  ): Promise<void> {
    const db = getDb();
    const req = await this.getRequest(requestId);
    if (!req) throw new Error(`Permission request not found: ${requestId}`);

    await db
      .update(permissionRequests)
      .set({ status: decision, reviewedBy, reviewedAt: new Date() })
      .where(eq(permissionRequests.id, requestId));

    await auditLog.append({
      projectId: req.projectId,
      actorType: 'user',
      actorId: reviewedBy,
      actionType: `permission_${decision}`,
      toolName: req.tool,
      inputSummary: `${req.operation} — request ${requestId}`,
      approvalStatus: decision,
    }).catch(err => console.warn('[audit] permission_resolved:', err));
  }

  async getRequest(requestId: string) {
    const db = getDb();
    const rows = await db
      .select()
      .from(permissionRequests)
      .where(eq(permissionRequests.id, requestId));
    return rows[0] ?? null;
  }

  /**
   * Returns true if there is an approved, unconsumed permission request that
   * matches (projectId, tool, operation) AND the SHA-256 of the exact tool
   * input being executed. Marks the request consumed so approvals cannot be
   * replayed for different inputs or reused across calls.
   */
  async checkApproved(
    projectId: string,
    tool: string,
    operation: string,
    toolInput?: unknown,
  ): Promise<boolean> {
    const db = getDb();
    const inputHash = toolInput !== undefined
      ? createHash('sha256').update(JSON.stringify(toolInput)).digest('hex')
      : null;

    const rows = await db
      .select()
      .from(permissionRequests)
      .where(
        and(
          eq(permissionRequests.projectId, projectId),
          eq(permissionRequests.tool, tool),
          eq(permissionRequests.operation, operation),
          eq(permissionRequests.status, 'approved'),
          eq(permissionRequests.consumed, false),
        )
      )
      .limit(1);

    if (rows.length === 0) return false;

    const row = rows[0];
    // If the approval was bound to a specific input hash, it must match exactly.
    if (row.toolInputHash !== null && row.toolInputHash !== inputHash) return false;

    // Mark consumed — this approval cannot be reused.
    await db
      .update(permissionRequests)
      .set({ consumed: true })
      .where(eq(permissionRequests.id, row.id));

    return true;
  }

  async grantRule(projectId: string, rule: PermissionRule): Promise<void> {
    const db = getDb();
    await db.insert(permissionRules).values({
      projectId,
      agentRole: rule.agentRole,
      tool: rule.tool,
      operations: rule.operations,
      level: rule.level,
      conditions: rule.conditions ?? null,
    });
  }
}

export const permissionEngine = new PermissionEngine();

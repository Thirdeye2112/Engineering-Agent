import { getDb } from '@consensus/db';
import { permissionRules, permissionRequests } from './schema.js';
import { and, eq } from 'drizzle-orm';
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
  ): Promise<{ requestId: string }> {
    const db = getDb();
    const id = uuidv4();
    await db.insert(permissionRequests).values({
      id,
      projectId,
      agentRole,
      tool,
      operation,
      rationale,
      status: 'pending',
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

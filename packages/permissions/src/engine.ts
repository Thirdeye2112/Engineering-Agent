import { getDb } from '@consensus/db';
import { permissionRules, permissionRequests } from './schema.js';
import { and, eq } from 'drizzle-orm';
import type { AgentRole } from '@consensus/shared-types';
import { v4 as uuidv4 } from 'uuid';

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
    return { requestId: id };
  }

  async resolveRequest(
    requestId: string,
    decision: 'approved' | 'denied',
    reviewedBy: string,
  ): Promise<void> {
    const db = getDb();
    await db
      .update(permissionRequests)
      .set({ status: decision, reviewedBy, reviewedAt: new Date() })
      .where(eq(permissionRequests.id, requestId));
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

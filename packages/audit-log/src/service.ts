import { createHash } from 'node:crypto';
import { getDb, auditEvents } from '@consensus/db';
import { desc, eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export type ActorType = 'user' | 'agent' | 'system' | 'tool';
export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'denied';

export interface AuditEventInput {
  projectId?: string;
  actorType: ActorType;
  actorId?: string;
  actionType: string;
  toolName?: string;
  inputSummary?: string;
  outputSummary?: string;
  approvalStatus?: ApprovalStatus;
}

export interface AuditEventRow extends AuditEventInput {
  id: string;
  previousEventHash: string;
  eventHash: string;
  createdAt: Date;
}

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

function computeHash(data: {
  id: string;
  projectId?: string | null;
  actorType: string;
  actorId?: string | null;
  actionType: string;
  toolName?: string | null;
  inputSummary?: string | null;
  outputSummary?: string | null;
  approvalStatus?: string | null;
  previousEventHash: string;
  createdAt: string;
}): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export class AuditLog {
  async append(event: AuditEventInput): Promise<void> {
    const db = getDb();
    const id = uuidv4();

    // Get previous event hash — global chain across all projects
    const lastRow = await db
      .select({ eventHash: auditEvents.eventHash })
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);

    const previousEventHash = lastRow[0]?.eventHash ?? GENESIS_HASH;
    const createdAt = new Date().toISOString();

    const eventHash = computeHash({
      id,
      projectId: event.projectId ?? null,
      actorType: event.actorType,
      actorId: event.actorId ?? null,
      actionType: event.actionType,
      toolName: event.toolName ?? null,
      inputSummary: event.inputSummary ?? null,
      outputSummary: event.outputSummary ?? null,
      approvalStatus: event.approvalStatus ?? null,
      previousEventHash,
      createdAt,
    });

    await db.insert(auditEvents).values({
      id,
      projectId: event.projectId,
      actorType: event.actorType,
      actorId: event.actorId,
      actionType: event.actionType,
      toolName: event.toolName,
      inputSummary: event.inputSummary,
      outputSummary: event.outputSummary,
      approvalStatus: event.approvalStatus,
      previousEventHash,
      eventHash,
      createdAt: new Date(createdAt),
    });
  }

  async verify(projectId?: string): Promise<{ valid: boolean; firstInvalidId?: string; checkedCount: number }> {
    const db = getDb();
    const rows = await db
      .select()
      .from(auditEvents)
      .orderBy(auditEvents.createdAt);

    // Filter to project if specified (but chain is global so we verify full chain)
    let expectedPrev = GENESIS_HASH;
    for (const row of rows) {
      if (row.previousEventHash !== expectedPrev) {
        return { valid: false, firstInvalidId: row.id, checkedCount: rows.indexOf(row) };
      }
      const recomputed = computeHash({
        id: row.id,
        projectId: row.projectId ?? null,
        actorType: row.actorType,
        actorId: row.actorId ?? null,
        actionType: row.actionType,
        toolName: row.toolName ?? null,
        inputSummary: row.inputSummary ?? null,
        outputSummary: row.outputSummary ?? null,
        approvalStatus: row.approvalStatus ?? null,
        previousEventHash: row.previousEventHash,
        createdAt: row.createdAt.toISOString(),
      });
      if (recomputed !== row.eventHash) {
        return { valid: false, firstInvalidId: row.id, checkedCount: rows.indexOf(row) };
      }
      expectedPrev = row.eventHash;
    }
    return { valid: true, checkedCount: rows.length };
  }

  async getEvents(projectId: string, limit = 100): Promise<AuditEventRow[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.projectId, projectId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);
    return rows.map(r => ({
      id: r.id,
      projectId: r.projectId ?? undefined,
      actorType: r.actorType as ActorType,
      actorId: r.actorId ?? undefined,
      actionType: r.actionType,
      toolName: r.toolName ?? undefined,
      inputSummary: r.inputSummary ?? undefined,
      outputSummary: r.outputSummary ?? undefined,
      approvalStatus: r.approvalStatus as ApprovalStatus | undefined,
      previousEventHash: r.previousEventHash,
      eventHash: r.eventHash,
      createdAt: r.createdAt,
    }));
  }
}

export const auditLog = new AuditLog();

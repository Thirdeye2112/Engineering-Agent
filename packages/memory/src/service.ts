import { getDb, projectMemories } from '@consensus/db';
import type { MemoryCategory } from '@consensus/db';
import { and, eq, isNull, gt, or, sql } from 'drizzle-orm';
import { redact } from '@consensus/secrets';
import { auditLog } from '@consensus/audit-log';

export type { MemoryCategory };

export interface MemoryRecord {
  id: string;
  projectId: string;
  repoFullName?: string;
  category: MemoryCategory;
  title: string;
  content: string;
  sourceType: string;
  sourceId?: string;
  confidence: number;
  supersededBy?: string;
  expiresAt?: Date;
  createdAt: Date;
}

export interface MemoryWriteInput {
  projectId: string;
  repoFullName?: string;
  category: MemoryCategory;
  title: string;
  content: string;
  sourceType: 'pr_outcome' | 'user_feedback' | 'agent_decision' | 'test_result' | 'review_finding';
  sourceId?: string;
  confidence?: number;
  expiresAt?: Date;
}

export interface MemoryQueryInput {
  projectId: string;
  repoFullName?: string;
  categories?: MemoryCategory[];
  /** Include expired memories (default: false) */
  includeExpired?: boolean;
  /** Include superseded memories (default: false) */
  includeSuperseded?: boolean;
  limit?: number;
}

export class ProjectMemory {
  async write(input: MemoryWriteInput): Promise<string> {
    const db = getDb();

    // Redact secrets before persisting
    const safeContent = redact(input.content);
    const safeTitle = redact(input.title);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = {
      projectId: input.projectId,
      repoFullName: input.repoFullName ?? null,
      category: input.category,
      title: safeTitle,
      content: safeContent,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      confidence: input.confidence ?? 0.8,
      expiresAt: input.expiresAt ?? null,
    };

    const inserted = await db
      .insert(projectMemories)
      .values(row)
      .returning({ id: projectMemories.id });

    const id = inserted[0]?.id ?? 'unknown';

    await auditLog.append({
      projectId: input.projectId,
      actorType: 'system',
      actorId: 'project-memory',
      actionType: 'memory.write',
      inputSummary: `[${input.category}] ${safeTitle.slice(0, 200)}`,
      outputSummary: `id=${id}`,
    }).catch(err => console.warn('[memory] audit write:', err));

    return id;
  }

  async retrieve(query: MemoryQueryInput): Promise<MemoryRecord[]> {
    const db = getDb();
    const now = new Date();

    const conditions = [eq(projectMemories.projectId, query.projectId)];

    if (!query.includeExpired) {
      conditions.push(
        or(isNull(projectMemories.expiresAt), gt(projectMemories.expiresAt, now))!,
      );
    }

    if (!query.includeSuperseded) {
      conditions.push(isNull(projectMemories.supersededBy));
    }

    const rows = await db
      .select()
      .from(projectMemories)
      .where(and(...conditions))
      .orderBy(projectMemories.createdAt)
      .limit(query.limit ?? 50);

    // Post-filter by category if specified (simpler than building dynamic SQL)
    const filtered = query.categories
      ? rows.filter(r => query.categories!.includes(r.category as MemoryCategory))
      : rows;

    // Post-filter by repoFullName if specified
    const byRepo = query.repoFullName
      ? filtered.filter(r => !r.repoFullName || r.repoFullName === query.repoFullName)
      : filtered;

    await auditLog.append({
      projectId: query.projectId,
      actorType: 'system',
      actorId: 'project-memory',
      actionType: 'memory.read',
      inputSummary: `categories=${query.categories?.join(',') ?? 'all'} repo=${query.repoFullName ?? 'any'}`,
      outputSummary: `returned=${byRepo.length}`,
    }).catch(err => console.warn('[memory] audit read:', err));

    return byRepo.map(r => ({
      id: r.id,
      projectId: r.projectId,
      repoFullName: r.repoFullName ?? undefined,
      category: r.category as MemoryCategory,
      title: r.title,
      content: r.content,
      sourceType: r.sourceType,
      sourceId: r.sourceId ?? undefined,
      confidence: r.confidence ?? 0.8,
      supersededBy: r.supersededBy ?? undefined,
      expiresAt: r.expiresAt ?? undefined,
      createdAt: r.createdAt,
    }));
  }

  async supersede(oldId: string, newId: string): Promise<void> {
    const db = getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db
      .update(projectMemories)
      .set({ supersededBy: sql`${newId}::uuid` } as any)
      .where(eq(projectMemories.id, oldId));
  }

  /** Format memories for inclusion in an agent prompt. */
  formatForPrompt(memories: MemoryRecord[]): string {
    if (memories.length === 0) return '';

    const grouped = new Map<MemoryCategory, MemoryRecord[]>();
    for (const m of memories) {
      const list = grouped.get(m.category) ?? [];
      list.push(m);
      grouped.set(m.category, list);
    }

    const sections: string[] = ['## Project memory (from prior tasks)'];

    for (const [category, items] of Array.from(grouped)) {
      const label = category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      sections.push(`\n### ${label}`);
      for (const item of items) {
        const conf = Math.round(item.confidence * 100);
        sections.push(`- **${item.title}** (confidence ${conf}%): ${item.content}`);
      }
    }

    return sections.join('\n');
  }
}

export const projectMemory = new ProjectMemory();

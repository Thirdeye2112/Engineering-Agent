import { pgTable, uuid, text, timestamp, real } from 'drizzle-orm/pg-core';

export type MemoryCategory =
  | 'architecture_decision'
  | 'repo_convention'
  | 'approved_pattern'
  | 'rejected_pattern'
  | 'recurring_test_failure'
  | 'security_constraint'
  | 'user_preference'
  | 'prior_pr_outcome'
  | 'agent_performance_note';

export const projectMemories = pgTable('project_memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: text('project_id').notNull(),
  repoFullName: text('repo_full_name'),
  category: text('category').notNull(),  // MemoryCategory
  title: text('title').notNull(),
  content: text('content').notNull(),    // redacted before insert
  sourceType: text('source_type').notNull(), // 'pr_outcome' | 'user_feedback' | 'agent_decision' | 'test_result' | 'review_finding'
  sourceId: text('source_id'),           // audit event ID, PR URL, task ID, etc.
  confidence: real('confidence').notNull().default(0.8),  // 0..1
  supersededBy: uuid('superseded_by'),   // FK to another memory row (self-ref)
  expiresAt: timestamp('expires_at'),    // null = never expires
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

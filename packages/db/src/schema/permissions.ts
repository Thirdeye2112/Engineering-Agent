import { pgTable, uuid, text, jsonb, timestamp, boolean } from 'drizzle-orm/pg-core';

export const permissionRules = pgTable('permission_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: text('project_id').notNull(),
  agentRole: text('agent_role').notNull(),
  tool: text('tool').notNull(),
  operations: jsonb('operations').notNull(),
  level: text('level').notNull(),
  conditions: jsonb('conditions'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const permissionRequests = pgTable('permission_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: text('project_id').notNull(),
  agentRole: text('agent_role').notNull(),
  tool: text('tool').notNull(),
  operation: text('operation').notNull(),
  rationale: text('rationale').notNull(),
  status: text('status').notNull().default('pending'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  /**
   * SHA-256 of the exact tool input the approval was granted for.
   * agent.useTool() sets this when creating the request; checkApproved()
   * matches on it so one approval can't be replayed for a different input.
   */
  toolInputHash: text('tool_input_hash'),
  /** True once this approval has been consumed — prevents replay. */
  consumed: boolean('consumed').notNull().default(false),
});

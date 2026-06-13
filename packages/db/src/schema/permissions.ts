import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const permissionRules = pgTable('permission_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  agentRole: text('agent_role').notNull(),
  tool: text('tool').notNull(),
  operations: jsonb('operations').notNull(),
  level: text('level').notNull(),
  conditions: jsonb('conditions'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const permissionRequests = pgTable('permission_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  agentRole: text('agent_role').notNull(),
  tool: text('tool').notNull(),
  operation: text('operation').notNull(),
  rationale: text('rationale').notNull(),
  status: text('status').notNull().default('pending'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

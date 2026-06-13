import { pgTable, uuid, text, timestamp, jsonb, integer, numeric } from 'drizzle-orm/pg-core';

export const deliberations = pgTable('deliberations', {
  id: uuid('id').primaryKey().defaultRandom(),
  task: text('task').notNull(),
  mode: text('mode').notNull(),
  status: text('status').notNull().default('pending'),
  rounds: integer('rounds').notNull().default(0),
  totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
});

export const agentPositions = pgTable('agent_positions', {
  id: uuid('id').primaryKey().defaultRandom(),
  deliberationId: uuid('deliberation_id').notNull().references(() => deliberations.id),
  agentRole: text('agent_role').notNull(),
  provider: text('provider').notNull(),
  tier: text('tier').notNull(),
  proposal: jsonb('proposal').notNull(),
  critiques: jsonb('critiques').notNull().default([]),
  finalVote: jsonb('final_vote'),
  riskFlags: jsonb('risk_flags').notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const synthesisResults = pgTable('synthesis_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  deliberationId: uuid('deliberation_id').notNull().references(() => deliberations.id),
  report: jsonb('report').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const conversationThreads = pgTable('conversation_threads', {
  id: text('id').primaryKey(),
  agentRole: text('agent_role').notNull(),
  deliberationId: text('deliberation_id').notNull(),
  messages: jsonb('messages').notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});


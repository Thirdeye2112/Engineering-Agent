import { pgTable, text, timestamp, uuid, serial } from 'drizzle-orm/pg-core';

export const auditEvents = pgTable('audit_events', {
  seq: serial('seq').notNull(),
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: text('project_id'),
  actorType: text('actor_type').notNull(), // 'user' | 'agent' | 'system' | 'tool'
  actorId: text('actor_id'),               // agentRole, userId, or system component name
  actionType: text('action_type').notNull(),
  toolName: text('tool_name'),
  inputSummary: text('input_summary'),
  outputSummary: text('output_summary'),
  approvalStatus: text('approval_status'), // 'not_required' | 'pending' | 'approved' | 'denied'
  previousEventHash: text('previous_event_hash').notNull(),
  eventHash: text('event_hash').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

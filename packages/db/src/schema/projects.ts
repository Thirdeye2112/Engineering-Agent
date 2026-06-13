import { pgTable, uuid, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  task: text('task').notNull(),
  mode: text('mode').notNull(),
  status: text('status').notNull().default('pending'),
  config: jsonb('config').notNull(),
  report: jsonb('report'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
});

export const subtasks = pgTable('subtasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  description: text('description').notNull(),
  assignedRole: text('assigned_role').notNull(),
  wave: integer('wave').notNull().default(0),
  dependencies: jsonb('dependencies').notNull().default([]),
  status: text('status').notNull().default('pending'),
  deliverable: text('deliverable'),
  completedAt: timestamp('completed_at'),
});

export const crossReviews = pgTable('cross_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  reviewerRole: text('reviewer_role').notNull(),
  targetSubtaskId: uuid('target_subtask_id').notNull().references(() => subtasks.id),
  concerns: jsonb('concerns').notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const integrationResults = pgTable('integration_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  integratedDocument: text('integrated_document').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

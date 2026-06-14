-- Migration 001: Bind approvals to tool input hash and add consumed flag
-- Apply with: psql $DATABASE_URL -f packages/db/migrations/001_approval_binding.sql

ALTER TABLE permission_requests
  ADD COLUMN IF NOT EXISTS tool_input_hash TEXT,
  ADD COLUMN IF NOT EXISTS consumed BOOLEAN NOT NULL DEFAULT FALSE;

-- Index to speed up checkApproved() lookups (hot path on every tool call)
CREATE INDEX IF NOT EXISTS idx_permission_requests_check
  ON permission_requests (project_id, tool, operation, status, consumed);

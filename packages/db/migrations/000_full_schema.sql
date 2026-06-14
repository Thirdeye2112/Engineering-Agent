-- Full schema — run this on a fresh database.
-- Usage: psql $DATABASE_URL -f packages/db/migrations/000_full_schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Audit chain
CREATE TABLE IF NOT EXISTS audit_events (
  seq          SERIAL NOT NULL,
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   TEXT,
  actor_type   TEXT NOT NULL,
  actor_id     TEXT,
  action_type  TEXT NOT NULL,
  tool_name    TEXT,
  input_summary  TEXT,
  output_summary TEXT,
  approval_status TEXT,
  previous_event_hash TEXT NOT NULL,
  event_hash   TEXT NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task         TEXT NOT NULL,
  mode         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  config       JSONB NOT NULL,
  report       JSONB,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subtasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),
  description     TEXT NOT NULL,
  assigned_role   TEXT NOT NULL,
  wave            INTEGER NOT NULL DEFAULT 0,
  dependencies    JSONB NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'pending',
  deliverable     TEXT,
  completed_at    TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cross_reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id),
  reviewer_role     TEXT NOT NULL,
  target_subtask_id UUID NOT NULL REFERENCES subtasks(id),
  verdict           TEXT,
  feedback          TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Permissions
CREATE TABLE IF NOT EXISTS permission_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  TEXT NOT NULL,
  agent_role  TEXT NOT NULL,
  tool        TEXT NOT NULL,
  operations  JSONB NOT NULL,
  level       TEXT NOT NULL,
  conditions  JSONB,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permission_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      TEXT NOT NULL,
  agent_role      TEXT NOT NULL,
  tool            TEXT NOT NULL,
  operation       TEXT NOT NULL,
  rationale       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  tool_input_hash TEXT,
  consumed        BOOLEAN NOT NULL DEFAULT FALSE
);

-- Memory
CREATE TABLE IF NOT EXISTS project_memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      TEXT NOT NULL,
  repo_full_name  TEXT,
  category        TEXT NOT NULL,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  source_type     TEXT NOT NULL,
  source_id       TEXT,
  confidence      REAL NOT NULL DEFAULT 0.8,
  superseded_by   UUID,
  expires_at      TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_events_seq ON audit_events(seq);
CREATE INDEX IF NOT EXISTS idx_audit_events_project ON audit_events(project_id);
CREATE INDEX IF NOT EXISTS idx_permission_requests_check
  ON permission_requests(project_id, tool, operation, status, consumed);
CREATE INDEX IF NOT EXISTS idx_project_memories_repo
  ON project_memories(repo_full_name);

SELECT 'Schema created successfully.' AS result;

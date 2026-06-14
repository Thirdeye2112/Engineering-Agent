#!/usr/bin/env bash
# Run this once to initialize the database schema.
# Usage: DATABASE_URL=postgres://... ./scripts/setup-db.sh

set -e

if [ -z "$DATABASE_URL" ]; then
  echo "❌  DATABASE_URL is not set."
  echo "    Get a free Postgres URL from https://neon.tech"
  exit 1
fi

echo "▶  Applying schema..."
pnpm --filter @consensus/db exec drizzle-kit push || {
  echo "drizzle-kit push failed — applying migrations manually via psql"
  psql "$DATABASE_URL" -f packages/db/migrations/001_approval_binding.sql
}

echo "✅  Database ready."

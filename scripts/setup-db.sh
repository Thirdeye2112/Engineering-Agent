#!/usr/bin/env bash
# Run this once to initialize the database schema.
# Usage: DATABASE_URL=postgres://... ./scripts/setup-db.sh

set -e

if [ -z "$DATABASE_URL" ]; then
  echo "❌  DATABASE_URL is not set."
  echo "    Get a free Postgres URL from https://neon.tech"
  exit 1
fi

echo "▶  Creating tables..."
psql "$DATABASE_URL" -f packages/db/migrations/000_full_schema.sql

echo "▶  Applying latest migration..."
psql "$DATABASE_URL" -f packages/db/migrations/001_approval_binding.sql

echo "✅  Database ready."

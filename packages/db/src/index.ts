import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as mainSchema from './schema/index.js';
import * as projectsSchema from './schema/projects.js';
import * as permissionsSchema from './schema/permissions.js';
import * as auditSchema from './schema/audit.js';
import * as memorySchema from './schema/memory.js';

export * from './schema/index.js';
export * from './schema/projects.js';
export * from './schema/permissions.js';
export * from './schema/audit.js';
export * from './schema/memory.js';

const schema = { ...mainSchema, ...projectsSchema, ...permissionsSchema, ...auditSchema, ...memorySchema };

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL not set');
    const client = postgres(connectionString);
    _db = drizzle(client, { schema });
  }
  return _db;
}

export { schema };

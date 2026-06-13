import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./src/schema/index.ts', './src/schema/projects.ts', './src/schema/permissions.ts', './src/schema/audit.ts', './src/schema/memory.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});

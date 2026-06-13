import { defineConfig } from 'drizzle-kit';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Walk up to find .env
function findEnv(dir: string): string | null {
  const candidate = resolve(dir, '.env');
  try { readFileSync(candidate); return candidate; } catch { /* not found */ }
  const parent = dirname(dir);
  if (parent === dir) return null;
  return findEnv(parent);
}

const envPath = findEnv(__dirname);
if (envPath) {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

export default defineConfig({
  schema: ['./src/schema/index.ts', './src/schema/projects.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});

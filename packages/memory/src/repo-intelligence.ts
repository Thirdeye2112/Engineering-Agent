import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

export interface RepoIntelligence {
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'unknown';
  isMonorepo: boolean;
  workspaces: string[];
  testCommands: string[];
  lintCommands: string[];
  typecheckCommands: string[];
  frameworks: string[];
  protectedFiles: string[];
  codeOwners: string[];
  entryPoints: string[];
  hasTypeScript: boolean;
  hasDockerfile: boolean;
  hasCiConfig: boolean;
  rawScripts: Record<string, string>;
}

function safeReadJSON(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function safeReadText(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

const FRAMEWORK_MARKERS: Array<{ dep: string; label: string }> = [
  { dep: 'react', label: 'React' },
  { dep: 'next', label: 'Next.js' },
  { dep: 'vue', label: 'Vue' },
  { dep: 'svelte', label: 'Svelte' },
  { dep: 'express', label: 'Express' },
  { dep: 'fastify', label: 'Fastify' },
  { dep: 'hono', label: 'Hono' },
  { dep: 'drizzle-orm', label: 'Drizzle ORM' },
  { dep: 'prisma', label: 'Prisma' },
  { dep: 'zod', label: 'Zod' },
  { dep: 'vitest', label: 'Vitest' },
  { dep: 'jest', label: 'Jest' },
  { dep: 'mocha', label: 'Mocha' },
  { dep: 'playwright', label: 'Playwright' },
  { dep: 'eslint', label: 'ESLint' },
  { dep: 'typescript', label: 'TypeScript' },
];

export function analyzeRepo(repoRoot: string): RepoIntelligence {
  const abs = resolve(repoRoot);

  // Detect package manager
  let packageManager: RepoIntelligence['packageManager'] = 'unknown';
  if (existsSync(join(abs, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
  else if (existsSync(join(abs, 'yarn.lock'))) packageManager = 'yarn';
  else if (existsSync(join(abs, 'package-lock.json'))) packageManager = 'npm';

  // Read root package.json
  const pkg = safeReadJSON(join(abs, 'package.json')) ?? {};
  const scripts = (pkg.scripts as Record<string, string>) ?? {};

  // Detect monorepo
  const isMonorepo = existsSync(join(abs, 'pnpm-workspace.yaml'))
    || (Array.isArray(pkg.workspaces));
  const workspaces: string[] = [];
  if (existsSync(join(abs, 'pnpm-workspace.yaml'))) {
    const ws = safeReadText(join(abs, 'pnpm-workspace.yaml')) ?? '';
    const matches = ws.match(/- ['"]?([^'"\n]+)['"]?/g) ?? [];
    workspaces.push(...matches.map(m => m.replace(/^-\s*['"]?|['"]?$/g, '')));
  } else if (Array.isArray(pkg.workspaces)) {
    workspaces.push(...(pkg.workspaces as string[]));
  }

  // Extract test/lint/typecheck commands from scripts
  const testCommands: string[] = [];
  const lintCommands: string[] = [];
  const typecheckCommands: string[] = [];

  const pm = packageManager === 'unknown' ? 'npm' : packageManager;

  for (const [name, cmd] of Object.entries(scripts)) {
    const lcName = name.toLowerCase();
    if (/^test/.test(lcName) || lcName === 'test') testCommands.push(`${pm} run ${name}`);
    if (/lint/.test(lcName)) lintCommands.push(`${pm} run ${name}`);
    if (/typecheck|type-check|tsc/.test(lcName)) typecheckCommands.push(`${pm} run ${name}`);
  }

  // Fallback defaults
  if (testCommands.length === 0) testCommands.push(`${pm} test`);
  if (lintCommands.length === 0 && existsSync(join(abs, '.eslintrc.js')) || existsSync(join(abs, 'eslint.config.js'))) {
    lintCommands.push('eslint .');
  }
  if (typecheckCommands.length === 0 && existsSync(join(abs, 'tsconfig.json'))) {
    typecheckCommands.push('tsc --noEmit');
  }

  // Detect frameworks from all dependencies
  const allDeps = {
    ...(pkg.dependencies as Record<string, string> ?? {}),
    ...(pkg.devDependencies as Record<string, string> ?? {}),
  };
  const frameworks = FRAMEWORK_MARKERS
    .filter(({ dep }) => dep in allDeps)
    .map(({ label }) => label);

  // Protected files
  const protectedFiles: string[] = [];
  for (const f of ['.env', '.env.local', '.env.production', 'secrets.json', 'credentials.json']) {
    if (existsSync(join(abs, f))) protectedFiles.push(f);
  }
  // Always flag these patterns
  protectedFiles.push('.env*', 'secrets.*', '**/credentials.*');

  // Code owners
  const codeOwners: string[] = [];
  const ownersText = safeReadText(join(abs, 'CODEOWNERS'))
    ?? safeReadText(join(abs, '.github', 'CODEOWNERS'))
    ?? safeReadText(join(abs, 'docs', 'CODEOWNERS'));
  if (ownersText) {
    const lines = ownersText.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    codeOwners.push(...lines.slice(0, 20));
  }

  // Entry points
  const entryPoints: string[] = [];
  for (const f of ['src/index.ts', 'src/index.js', 'index.ts', 'index.js', 'src/main.ts', 'src/main.js']) {
    if (existsSync(join(abs, f))) entryPoints.push(f);
  }

  return {
    packageManager,
    isMonorepo,
    workspaces,
    testCommands,
    lintCommands,
    typecheckCommands,
    frameworks,
    protectedFiles,
    codeOwners,
    entryPoints,
    hasTypeScript: existsSync(join(abs, 'tsconfig.json')),
    hasDockerfile: existsSync(join(abs, 'Dockerfile')) || existsSync(join(abs, 'docker-compose.yml')),
    hasCiConfig: existsSync(join(abs, '.github', 'workflows'))
      || existsSync(join(abs, '.gitlab-ci.yml'))
      || existsSync(join(abs, '.circleci', 'config.yml')),
    rawScripts: scripts,
  };
}

export function formatRepoIntelligenceForPrompt(intel: RepoIntelligence): string {
  const lines: string[] = ['## Repository intelligence'];
  lines.push(`- Package manager: **${intel.packageManager}**`);
  lines.push(`- Monorepo: ${intel.isMonorepo ? `yes (${intel.workspaces.join(', ')})` : 'no'}`);
  lines.push(`- TypeScript: ${intel.hasTypeScript ? 'yes' : 'no'}`);
  if (intel.frameworks.length) lines.push(`- Frameworks/libraries: ${intel.frameworks.join(', ')}`);
  if (intel.testCommands.length) lines.push(`- Test commands: ${intel.testCommands.join(' | ')}`);
  if (intel.lintCommands.length) lines.push(`- Lint commands: ${intel.lintCommands.join(' | ')}`);
  if (intel.typecheckCommands.length) lines.push(`- Typecheck commands: ${intel.typecheckCommands.join(' | ')}`);
  if (intel.entryPoints.length) lines.push(`- Entry points: ${intel.entryPoints.join(', ')}`);
  if (intel.protectedFiles.length) lines.push(`- Protected files (never modify): ${intel.protectedFiles.join(', ')}`);
  if (intel.hasCiConfig) lines.push('- CI/CD config detected');
  if (intel.codeOwners.length) lines.push(`- Code owners configured (${intel.codeOwners.length} rules)`);
  return lines.join('\n');
}

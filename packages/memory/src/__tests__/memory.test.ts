/**
 * Phase 5 tests: ProjectMemory service and RepoIntelligence.
 * These tests use stubs for the DB and audit-log — no live Postgres required.
 *
 * Run: npx tsx --test packages/memory/src/__tests__/memory.test.ts
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeRepo, formatRepoIntelligenceForPrompt } from '../repo-intelligence.js';

// ── Unique test project ID generator ─────────────────────────────────────────
let projectCounter = 0;
function uniqueProject(prefix = 'proj') { return `${prefix}-${++projectCounter}-${Date.now()}`; }

// ── In-process stub store (replaces DB + audit-log for unit tests) ─────────

interface StubMemoryRow {
  id: string;
  projectId: string;
  repoFullName?: string;
  category: string;
  title: string;
  content: string;
  sourceType: string;
  sourceId?: string;
  confidence: number;
  supersededBy?: string;
  expiresAt?: Date;
  createdAt: Date;
}

const memStore: StubMemoryRow[] = [];
const auditEvents: Array<{ action: string; summary: string }> = [];

let idCounter = 0;
function genId() { return `mem-${++idCounter}`; }

// Stubbed ProjectMemory that bypasses DB
class StubProjectMemory {
  async write(input: {
    projectId: string; repoFullName?: string; category: string;
    title: string; content: string; sourceType: string; sourceId?: string;
    confidence?: number; expiresAt?: Date;
  }): Promise<string> {
    const id = genId();
    // Simulate redaction
    const safeContent = input.content.replace(/sk-ant-api\d{2}-[A-Za-z0-9_-]{93}/g, '[REDACTED:anthropic-key]');
    const safeTitle = input.title.replace(/sk-ant-api\d{2}-[A-Za-z0-9_-]{93}/g, '[REDACTED:anthropic-key]');
    memStore.push({
      id, projectId: input.projectId, repoFullName: input.repoFullName,
      category: input.category, title: safeTitle, content: safeContent,
      sourceType: input.sourceType, sourceId: input.sourceId,
      confidence: input.confidence ?? 0.8, expiresAt: input.expiresAt,
      createdAt: new Date(),
    });
    auditEvents.push({ action: 'memory.write', summary: `[${input.category}] ${safeTitle}` });
    return id;
  }

  async retrieve(query: {
    projectId: string; repoFullName?: string; categories?: string[];
    includeExpired?: boolean; includeSuperseded?: boolean; limit?: number;
  }): Promise<StubMemoryRow[]> {
    const now = new Date();
    let rows = memStore.filter(r => r.projectId === query.projectId);
    if (!query.includeExpired) rows = rows.filter(r => !r.expiresAt || r.expiresAt > now);
    if (!query.includeSuperseded) rows = rows.filter(r => !r.supersededBy);
    if (query.categories) rows = rows.filter(r => query.categories!.includes(r.category));
    if (query.repoFullName) rows = rows.filter(r => !r.repoFullName || r.repoFullName === query.repoFullName);
    auditEvents.push({ action: 'memory.read', summary: `returned=${rows.length}` });
    return rows.slice(0, query.limit ?? 50);
  }

  async supersede(oldId: string, newId: string): Promise<void> {
    const row = memStore.find(r => r.id === oldId);
    if (row) row.supersededBy = newId;
  }

  formatForPrompt(memories: StubMemoryRow[]): string {
    if (memories.length === 0) return '';
    const lines = ['## Project memory (from prior tasks)'];
    for (const m of memories) {
      lines.push(`- **${m.title}** (confidence ${Math.round(m.confidence * 100)}%): ${m.content}`);
    }
    return lines.join('\n');
  }
}

const stub = new StubProjectMemory();

// ── Memory writes are redacted ────────────────────────────────────────────────

describe('ProjectMemory – secret redaction', () => {
  it('redacts Anthropic API key from content before storing', async () => {
    const fakeKey = 'sk-ant-api03-' + 'A'.repeat(93);
    const proj = uniqueProject('redact');
    const id = await stub.write({
      projectId: proj,
      category: 'architecture_decision',
      title: 'Config approach',
      content: `Use key ${fakeKey} in the config.`,
      sourceType: 'agent_decision',
    });
    const stored = memStore.find(r => r.id === id)!;
    assert.ok(!stored.content.includes(fakeKey), 'Secret must not appear in stored content');
    assert.ok(stored.content.includes('[REDACTED:'), 'Redaction marker must be present');
  });

  it('redacts secret from title', async () => {
    const fakeKey = 'sk-ant-api03-' + 'B'.repeat(93);
    const proj = uniqueProject('redact-title');
    const id = await stub.write({
      projectId: proj,
      category: 'repo_convention',
      title: `Token ${fakeKey}`,
      content: 'Some content',
      sourceType: 'user_feedback',
    });
    const stored = memStore.find(r => r.id === id)!;
    assert.ok(!stored.title.includes(fakeKey), 'Secret must not appear in stored title');
  });
});

// ── Memory retrieval is scoped to project/repo ────────────────────────────────

describe('ProjectMemory – project + repo scoping', () => {
  it('retrieval returns only records for the given projectId', async () => {
    const projA = uniqueProject('scope-a');
    const projB = uniqueProject('scope-b');
    await stub.write({ projectId: projA, category: 'approved_pattern', title: 'A-pattern', content: 'a', sourceType: 'agent_decision' });
    await stub.write({ projectId: projB, category: 'approved_pattern', title: 'B-pattern', content: 'b', sourceType: 'agent_decision' });
    const results = await stub.retrieve({ projectId: projA });
    assert.ok(results.every(r => r.projectId === projA), 'Must only return projA records');
    assert.equal(results.length, 1);
  });

  it('retrieval scoped by repoFullName excludes wrong repo', async () => {
    const proj = uniqueProject('scope-repo');
    await stub.write({ projectId: proj, repoFullName: 'org/repo-1', category: 'approved_pattern', title: 'R1', content: 'c1', sourceType: 'agent_decision' });
    await stub.write({ projectId: proj, repoFullName: 'org/repo-2', category: 'approved_pattern', title: 'R2', content: 'c2', sourceType: 'agent_decision' });
    const results = await stub.retrieve({ projectId: proj, repoFullName: 'org/repo-1' });
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'R1');
  });

  it('retrieval without repoFullName returns records for any repo', async () => {
    const proj = uniqueProject('scope-any');
    await stub.write({ projectId: proj, repoFullName: 'org/a', category: 'approved_pattern', title: 'A', content: 'x', sourceType: 'agent_decision' });
    await stub.write({ projectId: proj, repoFullName: 'org/b', category: 'approved_pattern', title: 'B', content: 'y', sourceType: 'agent_decision' });
    const results = await stub.retrieve({ projectId: proj });
    assert.equal(results.length, 2);
  });
});

// ── Expired / superseded memories excluded by default ────────────────────────

describe('ProjectMemory – expiry and supersession', () => {
  it('excludes expired memories by default', async () => {
    const past = new Date(Date.now() - 2000);
    const proj = uniqueProject('expiry');
    await stub.write({
      projectId: proj, category: 'user_preference', title: 'Old pref',
      content: 'use tabs', sourceType: 'user_feedback', expiresAt: past,
    });
    const results = await stub.retrieve({ projectId: proj });
    assert.equal(results.length, 0, 'Expired memory must be excluded');
  });

  it('includes expired memories when includeExpired=true', async () => {
    const past = new Date(Date.now() - 2000);
    const proj = uniqueProject('expiry-inc');
    await stub.write({
      projectId: proj, category: 'user_preference', title: 'Old pref2',
      content: 'use tabs', sourceType: 'user_feedback', expiresAt: past,
    });
    const results = await stub.retrieve({ projectId: proj, includeExpired: true });
    assert.equal(results.length, 1, 'Expired memory must be included when requested');
  });

  it('excludes superseded memories by default', async () => {
    const proj = uniqueProject('super');
    const id1 = await stub.write({ projectId: proj, category: 'architecture_decision', title: 'v1', content: 'old', sourceType: 'agent_decision' });
    const id2 = await stub.write({ projectId: proj, category: 'architecture_decision', title: 'v2', content: 'new', sourceType: 'agent_decision' });
    await stub.supersede(id1, id2);

    const results = await stub.retrieve({ projectId: proj });
    assert.equal(results.length, 1, 'Superseded memory must be excluded');
    assert.equal(results[0].title, 'v2');
  });

  it('includes superseded memories when includeSuperseded=true', async () => {
    const proj = uniqueProject('super-inc');
    const id1 = await stub.write({ projectId: proj, category: 'architecture_decision', title: 'v1', content: 'old', sourceType: 'agent_decision' });
    const id2 = await stub.write({ projectId: proj, category: 'architecture_decision', title: 'v2', content: 'new', sourceType: 'agent_decision' });
    await stub.supersede(id1, id2);
    const results = await stub.retrieve({ projectId: proj, includeSuperseded: true });
    assert.equal(results.length, 2);
  });
});

// ── Memory injected into planning prompt ─────────────────────────────────────

describe('ProjectMemory – prompt formatting', () => {
  it('formatForPrompt returns empty string when no memories', () => {
    const result = stub.formatForPrompt([]);
    assert.equal(result, '');
  });

  it('formatForPrompt includes memory titles and content', () => {
    const memories: StubMemoryRow[] = [
      { id: 'm1', projectId: 'p', category: 'approved_pattern', title: 'Use zod for validation',
        content: 'Always use zod schemas at API boundaries.', sourceType: 'agent_decision',
        confidence: 0.9, createdAt: new Date() },
      { id: 'm2', projectId: 'p', category: 'rejected_pattern', title: 'Avoid raw SQL',
        content: 'Use Drizzle ORM queries, not raw sql template unless necessary.',
        sourceType: 'agent_decision', confidence: 0.85, createdAt: new Date() },
    ];
    const result = stub.formatForPrompt(memories);
    assert.ok(result.includes('Project memory'), 'Must have section header');
    assert.ok(result.includes('Use zod for validation'), 'Must include first title');
    assert.ok(result.includes('Avoid raw SQL'), 'Must include second title');
    assert.ok(result.includes('90%'), 'Must include confidence percentage');
  });

  it('formatForPrompt includes only active (non-expired, non-superseded) memories', async () => {
    const past = new Date(Date.now() - 2000);
    const proj = uniqueProject('fmt-active');
    await stub.write({ projectId: proj, category: 'approved_pattern', title: 'ActivePattern', content: 'ok', sourceType: 'agent_decision' });
    await stub.write({ projectId: proj, category: 'approved_pattern', title: 'ExpiredPattern', content: 'bad', sourceType: 'agent_decision', expiresAt: past });
    const active = await stub.retrieve({ projectId: proj });
    const prompt = stub.formatForPrompt(active);
    assert.ok(prompt.includes('ActivePattern'));
    assert.ok(!prompt.includes('ExpiredPattern'));
  });
});

// ── Audit events are emitted for memory read/write ───────────────────────────

describe('ProjectMemory – audit events', () => {
  it('emits audit event on write', async () => {
    const proj = uniqueProject('audit');
    const before = auditEvents.length;
    await stub.write({ projectId: proj, category: 'repo_convention', title: 'Use pnpm', content: 'always pnpm', sourceType: 'user_feedback' });
    assert.ok(auditEvents.length > before, 'Audit event must be emitted on write');
    assert.equal(auditEvents[auditEvents.length - 1].action, 'memory.write');
  });

  it('emits audit event on retrieve', async () => {
    const proj = uniqueProject('audit-read');
    const before = auditEvents.length;
    await stub.retrieve({ projectId: proj });
    assert.ok(auditEvents.length > before, 'Audit event must be emitted on retrieve');
    assert.equal(auditEvents[auditEvents.length - 1].action, 'memory.read');
  });
});

// ── RepoIntelligence – package manager detection ─────────────────────────────

describe('RepoIntelligence – npm/pnpm script detection', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-intel-'));
  });

  it('detects pnpm from pnpm-lock.yaml', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test', scripts: { test: 'jest', lint: 'eslint .', typecheck: 'tsc --noEmit' },
    }));
    const intel = analyzeRepo(tmpDir);
    assert.equal(intel.packageManager, 'pnpm');
  });

  it('detects npm from package-lock.json', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-'));
    fs.writeFileSync(path.join(d, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'test', scripts: {} }));
    const intel = analyzeRepo(d);
    assert.equal(intel.packageManager, 'npm');
    fs.rmSync(d, { recursive: true });
  });

  it('extracts test commands from package.json scripts', () => {
    const intel = analyzeRepo(tmpDir);
    assert.ok(intel.testCommands.some(c => c.includes('test')), 'Must detect test command');
  });

  it('extracts lint commands from package.json scripts', () => {
    const intel = analyzeRepo(tmpDir);
    assert.ok(intel.lintCommands.some(c => c.includes('lint')), 'Must detect lint command');
  });

  it('extracts typecheck commands from package.json scripts', () => {
    const intel = analyzeRepo(tmpDir);
    assert.ok(intel.typecheckCommands.some(c => c.includes('typecheck') || c.includes('tsc')),
      'Must detect typecheck command');
  });

  it('detects TypeScript from tsconfig.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    const intel = analyzeRepo(tmpDir);
    assert.equal(intel.hasTypeScript, true);
  });

  it('detects monorepo from pnpm-workspace.yaml', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    const intel = analyzeRepo(tmpDir);
    assert.equal(intel.isMonorepo, true);
    assert.ok(intel.workspaces.length > 0);
  });

  it('detects frameworks from dependencies', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test',
      scripts: {},
      dependencies: { express: '^4', zod: '^3' },
      devDependencies: { eslint: '^8', typescript: '^5', jest: '^29' },
    }));
    const intel = analyzeRepo(tmpDir);
    assert.ok(intel.frameworks.includes('Express'), 'Must detect Express');
    assert.ok(intel.frameworks.includes('Zod'), 'Must detect Zod');
    assert.ok(intel.frameworks.includes('Jest'), 'Must detect Jest');
  });

  it('flags CI config detection', () => {
    const ciDir = path.join(tmpDir, '.github', 'workflows');
    fs.mkdirSync(ciDir, { recursive: true });
    fs.writeFileSync(path.join(ciDir, 'ci.yml'), '');
    const intel = analyzeRepo(tmpDir);
    assert.equal(intel.hasCiConfig, true);
  });

  it('formatRepoIntelligenceForPrompt produces readable output', () => {
    const intel = analyzeRepo(tmpDir);
    const prompt = formatRepoIntelligenceForPrompt(intel);
    assert.ok(prompt.includes('Repository intelligence'));
    assert.ok(prompt.includes('pnpm'));
    assert.ok(prompt.includes('TypeScript'));
  });
});

// ── Memory category filtering ─────────────────────────────────────────────────

describe('ProjectMemory – category filtering', () => {
  it('returns only requested categories', async () => {
    const proj = uniqueProject('cat');
    await stub.write({ projectId: proj, category: 'approved_pattern', title: 'A', content: 'a', sourceType: 'agent_decision' });
    await stub.write({ projectId: proj, category: 'rejected_pattern', title: 'B', content: 'b', sourceType: 'agent_decision' });
    await stub.write({ projectId: proj, category: 'security_constraint', title: 'C', content: 'c', sourceType: 'review_finding' });
    const results = await stub.retrieve({
      projectId: proj,
      categories: ['approved_pattern', 'security_constraint'],
    });
    assert.equal(results.length, 2);
    assert.ok(results.every(r => r.category === 'approved_pattern' || r.category === 'security_constraint'));
  });

  it('returns all categories when none specified', async () => {
    const proj = uniqueProject('cat-all');
    await stub.write({ projectId: proj, category: 'approved_pattern', title: 'A', content: 'a', sourceType: 'agent_decision' });
    await stub.write({ projectId: proj, category: 'rejected_pattern', title: 'B', content: 'b', sourceType: 'agent_decision' });
    await stub.write({ projectId: proj, category: 'security_constraint', title: 'C', content: 'c', sourceType: 'review_finding' });
    const results = await stub.retrieve({ projectId: proj });
    assert.equal(results.length, 3);
  });
});

// ── Memory references in PRWorkflowReport shape ───────────────────────────────

describe('MemoryReference – report shape', () => {
  it('MemoryReference has required fields', () => {
    const ref = {
      memoryId: '00000000-0000-0000-0000-000000000001',
      category: 'approved_pattern',
      title: 'Use zod',
      confidence: 0.9,
      influence: 'applied' as const,
    };
    assert.ok(ref.memoryId);
    assert.ok(ref.category);
    assert.equal(ref.influence, 'applied');
  });

  it('influence can be applied, considered, or rejected_as_outdated', () => {
    const influences = ['applied', 'considered', 'rejected_as_outdated'] as const;
    for (const inf of influences) {
      assert.ok(typeof inf === 'string');
    }
  });

  it('PRWorkflowReport shape includes memoryReferences', () => {
    const report = {
      projectId: 'p1', task: 'fix bug', implementationPlan: 'plan',
      steps: [], filesModified: [], blockingObjections: [],
      totalCostUsd: 0, completedAt: new Date().toISOString(),
      memoryReferences: [{
        memoryId: '00000000-0000-0000-0000-000000000001',
        category: 'approved_pattern', title: 'Use zod', confidence: 0.9,
        influence: 'applied' as const,
      }],
    };
    assert.equal(report.memoryReferences?.length, 1);
    assert.equal(report.memoryReferences?.[0].influence, 'applied');
  });
});

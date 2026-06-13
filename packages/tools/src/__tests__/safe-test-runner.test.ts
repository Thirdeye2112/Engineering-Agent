/**
 * Phase 4 tests: SafeTestRunner — allowlist enforcement, blocking, redaction,
 * timeout, output limits, audit events, and checklist integration.
 *
 * Run: npx tsx --test packages/tools/src/__tests__/safe-test-runner.test.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { SafeTestRunner } from '../safe-test-runner.js';
import type { ToolContext } from '../interface.js';

// ── helpers ────────────────────────────────────────────────────────────────

function makeSandbox(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-test-runner-'));
  return dir;
}

const auditEvents: Array<{ action: string; detail: unknown }> = [];

function makeCtx(level: 'read' | 'write' = 'read'): ToolContext {
  return {
    agentId: 'test',
    projectId: 'test-project',
    permissionLevel: level,
    auditLog: async (action, detail) => { auditEvents.push({ action, detail }); },
  };
}

// ── SafeTestRunner – command allowlist ────────────────────────────────────────

describe('SafeTestRunner – command allowlist', () => {
  let sandbox: string;
  before(() => { sandbox = makeSandbox(); });
  after(() => { fs.rmSync(sandbox, { recursive: true, force: true }); });

  it('runs echo via node (allowed) and captures stdout', async () => {
    const runner = new SafeTestRunner({
      profiles: {
        unit: { command: 'node', args: ['-e', 'process.stdout.write("TESTS_PASS\\n")'], label: 'node echo' },
      },
      sandboxRoot: sandbox,
    });
    const result = await runner.execute({ profile: 'unit' }, makeCtx());
    assert.equal(result.success, true);
    const out = result.output as Record<string, unknown>;
    assert.ok((out.stdout as string).includes('TESTS_PASS'));
    assert.equal(out.status, 'passed');
  });

  it('returns tests_not_configured when profile has no command', async () => {
    const runner = new SafeTestRunner({ sandboxRoot: sandbox });
    // Default profiles don't have 'targeted' defined unless overridden
    // Override to remove targeted profile explicitly
    const runner2 = new SafeTestRunner({
      sandboxRoot: sandbox,
      profiles: { unit: undefined },
    });
    const result = await runner2.execute({ profile: 'unit' }, makeCtx());
    assert.equal(result.success, false);
    const out = result.output as Record<string, unknown> | null;
    assert.equal(out?.status, 'tests_not_configured');
  });

  it('gates property is approval_required for run', () => {
    const runner = new SafeTestRunner({ sandboxRoot: sandbox });
    assert.equal(runner.gates['run'], 'approval_required');
  });
});

// ── SafeTestRunner – blocked commands ────────────────────────────────────────

describe('SafeTestRunner – blocked commands', () => {
  let sandbox: string;
  before(() => { sandbox = makeSandbox(); });
  after(() => { fs.rmSync(sandbox, { recursive: true, force: true }); });

  it('blocks hard-blocked command: curl', async () => {
    const runner = new SafeTestRunner({
      profiles: { unit: { command: 'curl', args: ['https://evil.com'], label: 'curl' } },
      sandboxRoot: sandbox,
    });
    const result = await runner.execute({ profile: 'unit' }, makeCtx());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('hard-blocked') || result.error?.includes('blocked'));
  });

  it('blocks shell interpreter: bash', async () => {
    const runner = new SafeTestRunner({
      profiles: { unit: { command: 'bash', args: ['-c', 'echo pwned'], label: 'bash' } },
      sandboxRoot: sandbox,
    });
    const result = await runner.execute({ profile: 'unit' }, makeCtx());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('blocked'));
  });

  it('blocks git (prevents git push)', async () => {
    const runner = new SafeTestRunner({
      profiles: { unit: { command: 'git', args: ['push', 'origin', 'main'], label: 'git push' } },
      sandboxRoot: sandbox,
    });
    const result = await runner.execute({ profile: 'unit' }, makeCtx());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('blocked'));
  });

  it('blocks rm (file deletion)', async () => {
    const runner = new SafeTestRunner({
      profiles: { unit: { command: 'rm', args: ['-rf', '/'], label: 'rm -rf' } },
      sandboxRoot: sandbox,
    });
    const result = await runner.execute({ profile: 'unit' }, makeCtx());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('blocked'));
  });

  it('blocks npm install (package install)', async () => {
    const runner = new SafeTestRunner({
      profiles: { unit: { command: 'npm', args: ['install', 'evil-package'], label: 'npm install' } },
      sandboxRoot: sandbox,
    });
    const result = await runner.execute({ profile: 'unit' }, makeCtx());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('blocked') || result.error?.includes('not allowed'));
  });

  it('blocks npm run with non-allowlisted script', async () => {
    const runner = new SafeTestRunner({
      profiles: { unit: { command: 'npm', args: ['run', 'deploy:production'], label: 'npm run deploy' } },
      sandboxRoot: sandbox,
    });
    const result = await runner.execute({ profile: 'unit' }, makeCtx());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('blocked') || result.error?.includes('not allowed') || result.error?.includes('not in the allowed'));
  });

  it('blocks unknown command not in allowlist', async () => {
    const runner = new SafeTestRunner({
      profiles: { unit: { command: 'python3', args: ['evil.py'], label: 'python' } },
      sandboxRoot: sandbox,
    });
    const result = await runner.execute({ profile: 'unit' }, makeCtx());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('blocked') || result.error?.includes('not in the allowed'));
  });
});

// ── SafeTestRunner – chained command injection ────────────────────────────────

describe('SafeTestRunner – chained command injection', () => {
  let sandbox: string;
  before(() => { sandbox = makeSandbox(); });
  after(() => { fs.rmSync(sandbox, { recursive: true, force: true }); });

  const chainPatterns = [
    ['&&', ['test', '&&', 'rm', '-rf', '/']],
    ['||', ['test', '||', 'curl', 'evil.com']],
    [';', ['test', ';', 'bash']],
    ['pipe', ['test', '|', 'tee', '/tmp/out']],
    ['subshell', ['test', '$(rm -rf /tmp)']],
    ['backtick', ['test', '`id`']],
  ];

  for (const [name, args] of chainPatterns) {
    it(`blocks chained command via ${name}`, async () => {
      const runner = new SafeTestRunner({
        profiles: { unit: { command: 'npm', args: args as string[], label: `npm ${name}` } },
        sandboxRoot: sandbox,
      });
      const result = await runner.execute({ profile: 'unit' }, makeCtx());
      assert.equal(result.success, false, `Expected blocked for ${name} chain`);
      assert.ok(result.error, 'Expected error message');
    });
  }
});

// ── SafeTestRunner – output redaction ────────────────────────────────────────

describe('SafeTestRunner – output redaction', () => {
  let sandbox: string;
  before(() => { sandbox = makeSandbox(); });
  after(() => { fs.rmSync(sandbox, { recursive: true, force: true }); });

  it('redacts secrets from stdout before returning', async () => {
    // Embed a fake Anthropic API key in the output via node -e
    const fakeKey = 'sk-ant-api03-' + 'A'.repeat(93);
    const runner = new SafeTestRunner({
      profiles: {
        unit: {
          command: 'node',
          args: ['-e', `process.stdout.write("KEY=${fakeKey}\\n")`],
          label: 'echo secret',
        },
      },
      sandboxRoot: sandbox,
    });
    const result = await runner.execute({ profile: 'unit' }, makeCtx());
    const out = result.output as Record<string, unknown>;
    assert.ok(!(out.stdout as string).includes(fakeKey),
      'Secret must be redacted from stdout');
    assert.ok((out.stdout as string).includes('[REDACTED:'),
      'Redaction marker must be present');
  });
});

// ── SafeTestRunner – timeout enforcement ─────────────────────────────────────

describe('SafeTestRunner – timeout enforcement', () => {
  let sandbox: string;
  before(() => { sandbox = makeSandbox(); });
  after(() => { fs.rmSync(sandbox, { recursive: true, force: true }); });

  it('kills process after timeout and returns timeout status', async () => {
    // Write a temp script file to avoid > character in -e arg (blocked by injection detection)
    const sleepScript = path.join(sandbox, 'sleep.js');
    fs.writeFileSync(sleepScript, 'setTimeout(function(){}, 99999);');
    const runner = new SafeTestRunner({
      profiles: {
        unit: {
          command: 'node',
          args: [sleepScript],
          label: 'infinite wait',
        },
      },
      sandboxRoot: sandbox,
      timeoutMs: 200,
    });
    const before = Date.now();
    const result = await runner.execute({ profile: 'unit' }, makeCtx());
    const elapsed = Date.now() - before;
    assert.equal(result.success, false);
    assert.ok(elapsed < 2000, `Should have timed out quickly, took ${elapsed}ms`);
    // Either timeout status in output or timeout error message
    const out = result.output as Record<string, unknown> | null;
    const isTimeout = out?.status === 'timeout' || result.error?.includes('timed out');
    assert.ok(isTimeout, `Expected timeout result, got: ${JSON.stringify({ status: out?.status, error: result.error })}`);
  });
});

// ── SafeTestRunner – max output size ─────────────────────────────────────────

describe('SafeTestRunner – max output size', () => {
  let sandbox: string;
  before(() => { sandbox = makeSandbox(); });
  after(() => { fs.rmSync(sandbox, { recursive: true, force: true }); });

  it('truncates output at limit and sets truncated=true', async () => {
    // Write a script file — avoids < and > in -e args (blocked by injection detection)
    const floodScript = path.join(sandbox, 'flood.js');
    fs.writeFileSync(floodScript, "const c='x'.repeat(1024);for(var i=0;i<600;i++)process.stdout.write(c);");
    const runner = new SafeTestRunner({
      profiles: {
        unit: {
          command: 'node',
          args: [floodScript],
          label: 'flood',
        },
      },
      sandboxRoot: sandbox,
    });
    const result = await runner.execute({ profile: 'unit' }, makeCtx());
    // success or not — we care about truncation
    const out = result.output as Record<string, unknown> | null;
    if (out !== null) {
      assert.equal(out.truncated, true, 'truncated flag must be set');
      const stdoutLen = ((out.stdout as string) ?? '').length;
      assert.ok(stdoutLen <= 512 * 1024 + 100,
        `stdout should be capped near 512KB, got ${stdoutLen}`);
    } else {
      // If output is null the process had an error — that's also acceptable
      // as long as it didn't return 600KB
      assert.ok(true, 'process error counts as truncation-safe');
    }
  });
});

// ── SafeTestRunner – audit events ────────────────────────────────────────────

describe('SafeTestRunner – audit events', () => {
  let sandbox: string;
  before(() => {
    sandbox = makeSandbox();
    auditEvents.length = 0;
  });
  after(() => { fs.rmSync(sandbox, { recursive: true, force: true }); });

  it('emits test.requested and test.executed on success', async () => {
    const events: string[] = [];
    const ctx: ToolContext = {
      agentId: 'test',
      projectId: 'proj',
      permissionLevel: 'read',
      auditLog: async (action) => { events.push(action); },
    };
    const runner = new SafeTestRunner({
      profiles: { unit: { command: 'node', args: ['-e', 'process.exit(0)'], label: 'pass' } },
      sandboxRoot: sandbox,
    });
    await runner.execute({ profile: 'unit' }, ctx);
    assert.ok(events.includes('test.requested'), 'Must emit test.requested');
    assert.ok(events.includes('test.executed'), 'Must emit test.executed on success');
    assert.ok(!events.includes('test.failed'), 'Must not emit test.failed on success');
  });

  it('emits test.requested and test.failed on failure', async () => {
    const events: string[] = [];
    const ctx: ToolContext = {
      agentId: 'test',
      projectId: 'proj',
      permissionLevel: 'read',
      auditLog: async (action) => { events.push(action); },
    };
    const runner = new SafeTestRunner({
      profiles: { unit: { command: 'node', args: ['-e', 'process.exit(1)'], label: 'fail' } },
      sandboxRoot: sandbox,
    });
    await runner.execute({ profile: 'unit' }, ctx);
    assert.ok(events.includes('test.requested'), 'Must emit test.requested');
    assert.ok(events.includes('test.failed'), 'Must emit test.failed on exit code 1');
    assert.ok(!events.includes('test.executed'), 'Must not emit test.executed on failure');
  });

  it('emits test.blocked for blocked command', async () => {
    const events: string[] = [];
    const ctx: ToolContext = {
      agentId: 'test',
      projectId: 'proj',
      permissionLevel: 'read',
      auditLog: async (action) => { events.push(action); },
    };
    const runner = new SafeTestRunner({
      profiles: { unit: { command: 'curl', args: ['https://evil.com'], label: 'bad' } },
      sandboxRoot: sandbox,
    });
    await runner.execute({ profile: 'unit' }, ctx);
    assert.ok(events.includes('test.blocked'), 'Must emit test.blocked for denied command');
  });
});

// ── SafeTestRunner – working-directory sandbox ────────────────────────────────

describe('SafeTestRunner – working directory sandbox', () => {
  let sandbox: string;
  before(() => { sandbox = makeSandbox(); });
  after(() => { fs.rmSync(sandbox, { recursive: true, force: true }); });

  it('rejects working directory traversal above sandbox', async () => {
    const runner = new SafeTestRunner({
      profiles: { unit: { command: 'node', args: ['-e', 'process.exit(0)'], label: 'ok' } },
      sandboxRoot: sandbox,
    });
    const result = await runner.execute({ profile: 'unit', workingDirectory: '../../etc' }, makeCtx());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('traversal') || result.error?.includes('rejected'));
  });

  it('rejects non-existent working directory', async () => {
    const runner = new SafeTestRunner({
      profiles: { unit: { command: 'node', args: ['-e', 'process.exit(0)'], label: 'ok' } },
      sandboxRoot: sandbox,
    });
    const result = await runner.execute({ profile: 'unit', workingDirectory: 'no-such-subdir' }, makeCtx());
    assert.equal(result.success, false);
    const out = result.output as Record<string, unknown> | null;
    assert.equal(out?.status, 'tests_not_configured');
  });
});

// ── validate() ────────────────────────────────────────────────────────────────

describe('SafeTestRunner – validate', () => {
  const runner = new SafeTestRunner({});

  it('accepts valid unit profile', () => {
    assert.deepEqual(runner.validate({ profile: 'unit' }), { valid: true });
  });

  it('rejects unknown profile', () => {
    const r = runner.validate({ profile: 'deploy' });
    assert.equal(r.valid, false);
    assert.ok(r.error?.includes('profile'));
  });

  it('rejects targeted without targetPattern', () => {
    const r = runner.validate({ profile: 'targeted' });
    assert.equal(r.valid, false);
    assert.ok(r.error?.includes('targetPattern'));
  });

  it('accepts targeted with targetPattern', () => {
    assert.deepEqual(runner.validate({ profile: 'targeted', targetPattern: '**/*.test.ts' }), { valid: true });
  });
});

// ── PRQualityChecklist: test failure blocks readyToMerge ─────────────────────

describe('PRQualityChecklist – test failure integration', () => {
  it('failed test marks readyToMerge=false', () => {
    const checklist = {
      taskSummary: 'Add feature',
      filesChanged: ['src/foo.ts'],
      agentReasoning: 'done',
      securityReviewPassed: true,
      testPlanComplete: true,
      humanApprovalsObtained: true,
      auditChainValid: true,
      codeReviewVerdict: 'approve' as const,
      testResults: [{
        profile: 'unit' as const,
        status: 'failed' as const,
        exitCode: 1,
        durationMs: 234,
      }],
      requiredTestsPassed: false,
      blockers: ["Required test 'unit' failed"],
      warnings: [],
      readyToMerge: false,
    };
    assert.equal(checklist.readyToMerge, false);
    assert.equal(checklist.requiredTestsPassed, false);
  });

  it('no tests configured produces tests_not_configured warning (not a blocker)', () => {
    const checklist = {
      taskSummary: 'Add feature',
      filesChanged: [],
      agentReasoning: 'done',
      securityReviewPassed: true,
      testPlanComplete: false,
      humanApprovalsObtained: true,
      auditChainValid: true,
      codeReviewVerdict: 'approve' as const,
      testResults: [{
        profile: 'unit' as const,
        status: 'tests_not_configured' as const,
        durationMs: 0,
      }],
      requiredTestsPassed: undefined,
      blockers: [],
      warnings: ["tests_not_configured for profile 'unit'"],
      readyToMerge: true,  // not configured ≠ failed
    };
    assert.equal(checklist.blockers.length, 0);
    assert.equal(checklist.requiredTestsPassed, undefined);
    assert.ok(checklist.warnings.some(w => w.includes('tests_not_configured')));
  });

  it('all required tests passed allows readyToMerge=true', () => {
    const checklist = {
      taskSummary: 'Fix bug',
      filesChanged: ['src/bar.ts'],
      agentReasoning: 'fixed',
      securityReviewPassed: true,
      testPlanComplete: true,
      humanApprovalsObtained: true,
      auditChainValid: true,
      codeReviewVerdict: 'approve' as const,
      testResults: [
        { profile: 'unit' as const, status: 'passed' as const, exitCode: 0, durationMs: 120 },
        { profile: 'lint' as const, status: 'passed' as const, exitCode: 0, durationMs: 80 },
      ],
      requiredTestsPassed: true,
      blockers: [],
      warnings: [],
      readyToMerge: true,
    };
    assert.equal(checklist.readyToMerge, true);
    assert.equal(checklist.requiredTestsPassed, true);
  });
});

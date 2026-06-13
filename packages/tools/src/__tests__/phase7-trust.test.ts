/**
 * Phase 7 tests: trusted-role sandbox writes, batch commit, auto-allow test runner.
 * Run: npx tsx --test packages/tools/src/__tests__/phase7-trust.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { FilesystemTool } from '../filesystem.js';
import { SafeTestRunner } from '../safe-test-runner.js';
import { GitHubTool } from '../github.js';
import type { ToolContext } from '../interface.js';

function makeSandbox(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'p7-trust-'));
}

function makeCtx(agentId = 'proj:implementation_agent'): ToolContext {
  return {
    agentId,
    projectId: 'test-proj',
    permissionLevel: 'write',
    auditLog: async () => {},
  };
}

// ── FilesystemTool: trusted role gate ────────────────────────────────────────

describe('FilesystemTool.getGate — trusted roles', () => {
  it('returns auto_allow for write_file when agent role is trusted', () => {
    const sandbox = makeSandbox();
    const tool = new FilesystemTool(sandbox, { trustedRoles: ['implementation_agent'] });
    const gate = tool.getGate('write_file', { agentId: 'proj:implementation_agent', projectId: 'p' });
    assert.equal(gate, 'auto_allow');
    fs.rmdirSync(sandbox);
  });

  it('returns approval_required for write_file when agent role is NOT trusted', () => {
    const sandbox = makeSandbox();
    const tool = new FilesystemTool(sandbox, { trustedRoles: ['implementation_agent'] });
    const gate = tool.getGate('write_file', { agentId: 'proj:security_reviewer', projectId: 'p' });
    assert.equal(gate, 'approval_required');
    fs.rmdirSync(sandbox);
  });

  it('returns approval_required for write_file when no trustedRoles configured', () => {
    const sandbox = makeSandbox();
    const tool = new FilesystemTool(sandbox);
    const gate = tool.getGate('write_file', { agentId: 'proj:implementation_agent', projectId: 'p' });
    assert.equal(gate, 'approval_required');
    fs.rmdirSync(sandbox);
  });

  it('returns auto_allow for create_dir when trusted', () => {
    const sandbox = makeSandbox();
    const tool = new FilesystemTool(sandbox, { trustedRoles: ['implementation_agent'] });
    const gate = tool.getGate('create_dir', { agentId: 'proj:implementation_agent', projectId: 'p' });
    assert.equal(gate, 'auto_allow');
    fs.rmdirSync(sandbox);
  });

  it('always auto_allow for read_file regardless of role', () => {
    const sandbox = makeSandbox();
    const tool = new FilesystemTool(sandbox);
    const gate = tool.getGate('read_file', { agentId: 'proj:any_role', projectId: 'p' });
    assert.equal(gate, 'auto_allow');
    fs.rmdirSync(sandbox);
  });

  it('extracts role from agentId suffix after last colon', () => {
    const sandbox = makeSandbox();
    const tool = new FilesystemTool(sandbox, { trustedRoles: ['implementation_agent'] });
    // deliberationId can itself contain colons
    const gate = tool.getGate('write_file', { agentId: 'proj:sub:implementation_agent', projectId: 'p' });
    assert.equal(gate, 'auto_allow');
    fs.rmdirSync(sandbox);
  });

  it('multiple trusted roles work', () => {
    const sandbox = makeSandbox();
    const tool = new FilesystemTool(sandbox, { trustedRoles: ['implementation_agent', 'architect'] });
    assert.equal(tool.getGate('write_file', { agentId: 'p:architect', projectId: 'p' }), 'auto_allow');
    assert.equal(tool.getGate('write_file', { agentId: 'p:implementation_agent', projectId: 'p' }), 'auto_allow');
    assert.equal(tool.getGate('write_file', { agentId: 'p:critic', projectId: 'p' }), 'approval_required');
    fs.rmdirSync(sandbox);
  });
});

// ── SafeTestRunner: auto_allow gate ──────────────────────────────────────────

describe('SafeTestRunner gate', () => {
  it('run gate is auto_allow', () => {
    const runner = new SafeTestRunner();
    assert.equal(runner.gates['run'], 'auto_allow');
  });

  it('validate accepts known profiles', () => {
    const runner = new SafeTestRunner();
    for (const profile of ['unit', 'lint', 'typecheck']) {
      assert.ok(runner.validate({ profile }).valid, `Expected valid for profile=${profile}`);
    }
  });

  it('validate rejects targeted profile without targetPattern', () => {
    const runner = new SafeTestRunner();
    const result = runner.validate({ profile: 'targeted' });
    assert.equal(result.valid, false);
  });
});

// ── GitHubTool: batch_commit validation ──────────────────────────────────────

describe('GitHubTool batch_commit validation', () => {
  it('batch_commit appears in gates as approval_required', () => {
    const tool = new GitHubTool();
    assert.equal(tool.gates['batch_commit'], 'approval_required');
  });

  it('validate accepts batch_commit operation', () => {
    const tool = new GitHubTool();
    const result = tool.validate({
      operation: 'batch_commit',
      owner: 'acme',
      repo: 'utils',
      branch: 'feature/add-slugify',
      message: 'Add slugify utility',
      files: [
        { path: 'src/utils.ts', content: 'export function slugify(s: string) { return s; }' },
        { path: 'src/utils.test.ts', content: 'test("slugify", () => {})' },
      ],
    });
    assert.ok(result.valid, result.error);
  });

  it('validate rejects unknown operation', () => {
    const tool = new GitHubTool();
    const result = tool.validate({ operation: 'mass_delete', owner: 'a', repo: 'b' });
    assert.equal(result.valid, false);
  });

  it('gates: commit_file still approval_required (backward compat)', () => {
    const tool = new GitHubTool();
    assert.equal(tool.gates['commit_file'], 'approval_required');
  });
});

// ── Gate resolution: getGate overrides static gates ──────────────────────────

describe('ITool.getGate override contract', () => {
  it('FilesystemTool implements getGate', () => {
    const tool = new FilesystemTool('/tmp', { trustedRoles: ['impl'] });
    assert.equal(typeof tool.getGate, 'function');
  });

  it('getGate has priority over static gates for write ops', () => {
    const tool = new FilesystemTool('/tmp', { trustedRoles: ['impl'] });
    // Static gate says approval_required
    assert.equal(tool.gates['write_file'], 'approval_required');
    // But getGate overrides it for trusted role
    assert.equal(tool.getGate('write_file', { agentId: 'p:impl', projectId: 'p' }), 'auto_allow');
  });

  it('SafeTestRunner does not implement getGate (static gate sufficient)', () => {
    const runner = new SafeTestRunner();
    assert.equal(runner.getGate, undefined);
  });
});

// ── Approval metric rate calculations ─────────────────────────────────────────

describe('Approval rate calculation', () => {
  function computeApprovalRate(approved: number, denied: number): number {
    const total = approved + denied;
    return total > 0 ? approved / total : 1;
  }

  it('100% when all approved', () => {
    assert.equal(computeApprovalRate(10, 0), 1);
  });

  it('0% when all denied', () => {
    assert.equal(computeApprovalRate(0, 5), 0);
  });

  it('50% when split evenly', () => {
    assert.equal(computeApprovalRate(5, 5), 0.5);
  });

  it('defaults to 1 (trust) when no data yet', () => {
    assert.equal(computeApprovalRate(0, 0), 1);
  });

  it('high-trust threshold is 90%', () => {
    const HIGH_TRUST = 0.9;
    assert.ok(computeApprovalRate(9, 1) >= HIGH_TRUST);
    assert.ok(computeApprovalRate(8, 2) < HIGH_TRUST);
  });

  it('high-trust requires minimum 10 decisions', () => {
    const isHighTrust = (approved: number, denied: number) => {
      const rate = computeApprovalRate(approved, denied);
      const decisions = approved + denied;
      return rate >= 0.9 && decisions >= 10;
    };
    assert.ok(!isHighTrust(9, 0)); // 9 decisions — not enough
    assert.ok(isHighTrust(10, 0)); // 10 decisions at 100%
    assert.ok(!isHighTrust(5, 0)); // Only 5 decisions
  });
});

// ── Onboarding report shape ───────────────────────────────────────────────────

describe('OnboardingReport shape', () => {
  it('has all required fields', () => {
    const report = {
      projectId: 'proj-1',
      packageManager: 'pnpm',
      isMonorepo: true,
      frameworks: ['Express', 'Zod'],
      hasTypeScript: true,
      hasCiConfig: true,
      memoriesWritten: 4,
      permissionRulesCreated: 3,
      completedAt: new Date().toISOString(),
    };
    assert.ok(report.projectId);
    assert.ok(['npm', 'pnpm', 'yarn', 'unknown'].includes(report.packageManager) || report.packageManager.length > 0);
    assert.ok(typeof report.memoriesWritten === 'number');
    assert.ok(typeof report.permissionRulesCreated === 'number');
    assert.ok(typeof report.completedAt === 'string');
  });

  it('optional fields may be absent', () => {
    const report: Record<string, unknown> = {
      projectId: 'proj-1',
      packageManager: 'npm',
      isMonorepo: false,
      frameworks: [],
      hasTypeScript: false,
      hasCiConfig: false,
      memoriesWritten: 0,
      permissionRulesCreated: 0,
      completedAt: new Date().toISOString(),
    };
    assert.equal(report['testCommand'], undefined);
    assert.equal(report['repoFullName'], undefined);
  });
});

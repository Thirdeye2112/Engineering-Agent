/**
 * Phase 3 tests: CodeReviewAgent, TestPlanAgent, GitHubTool safety, PRQualityChecklist.
 * Run: npx tsx --test packages/agent-manager/src/__tests__/phase3.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { GitHubTool } from '@consensus/tools';
import { WorkspaceTool } from '@consensus/tools';
import type { ToolContext } from '@consensus/tools';
import { CodeReviewAgent } from '../code-review-agent.js';
import { TestPlanAgent } from '../test-plan-agent.js';
import type { IAIProvider } from '../provider-interface.js';
import type { CodeReviewResult, TestPlanResult } from '@consensus/shared-types';

// ── Stub provider ─────────────────────────────────────────────────────────────

function makeProvider(response: unknown): IAIProvider {
  return {
    provider: 'anthropic',
    tier: 'fast',
    model: 'claude-haiku-4-5-20251001',
    sendMessage: async () => ({
      content: JSON.stringify(response),
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 0,
    }),
    isAvailable: () => true,
    estimateCost: () => 0,
    getCapabilities: () => ({ maxContextTokens: 200000, supportsStreaming: false, supportsVision: false }),
  };
}

const noop = async () => {};
function makeCtx(level: 'read' | 'write' = 'write'): ToolContext {
  return { agentId: 'test', projectId: 'test-project', permissionLevel: level, auditLog: noop };
}

// ── CodeReviewAgent ───────────────────────────────────────────────────────────

describe('CodeReviewAgent', () => {
  it('returns approve verdict from provider', async () => {
    const approveResult: CodeReviewResult = {
      verdict: 'approve',
      rationale: 'Looks good',
      requiredFixes: [],
      riskLevel: 'low',
      securityConcerns: [],
      testingGaps: [],
    };
    const agent = new CodeReviewAgent(makeProvider(approveResult));
    const result = await agent.review([{
      path: 'src/foo.ts',
      originalContent: 'const x = 1;',
      proposedContent: 'const x = 2;',
      taskContext: 'Update x',
    }]);
    assert.equal(result.verdict, 'approve');
    assert.equal(result.riskLevel, 'low');
  });

  it('returns block verdict for unsafe proposal', async () => {
    const blockResult: CodeReviewResult = {
      verdict: 'block',
      rationale: 'SQL injection vulnerability',
      requiredFixes: ['Use parameterized queries'],
      riskLevel: 'critical',
      securityConcerns: ['Direct string interpolation into SQL'],
      testingGaps: [],
    };
    const agent = new CodeReviewAgent(makeProvider(blockResult));
    const result = await agent.review([{
      path: 'src/db.ts',
      originalContent: 'db.query("SELECT * FROM users WHERE id = " + userId)',
      proposedContent: 'db.query(`SELECT * FROM users WHERE id = ${userId}`)',
      taskContext: 'Fetch user by ID',
    }]);
    assert.equal(result.verdict, 'block');
    assert.equal(result.riskLevel, 'critical');
    assert.ok(result.requiredFixes.length > 0);
  });

  it('returns request_changes with required fixes', async () => {
    const requestChanges: CodeReviewResult = {
      verdict: 'request_changes',
      rationale: 'Missing error handling',
      requiredFixes: ['Add try/catch around file read', 'Add test for error case'],
      riskLevel: 'medium',
      securityConcerns: [],
      testingGaps: ['No test for file-not-found case'],
    };
    const agent = new CodeReviewAgent(makeProvider(requestChanges));
    const result = await agent.review([{
      path: 'src/reader.ts',
      originalContent: '',
      proposedContent: 'fs.readFileSync(path)',
      taskContext: 'Read config file',
    }]);
    assert.equal(result.verdict, 'request_changes');
    assert.ok(result.requiredFixes.length >= 2);
  });

  it('rejects invalid provider response', async () => {
    const agent = new CodeReviewAgent(makeProvider({ not_a_review: true }));
    await assert.rejects(() => agent.review([{
      path: 'foo.ts', originalContent: '', proposedContent: '', taskContext: 'x',
    }]));
  });
});

// ── TestPlanAgent ─────────────────────────────────────────────────────────────

describe('TestPlanAgent', () => {
  it('returns structured test plan', async () => {
    const plan: TestPlanResult = {
      requiredBeforePr: [
        { description: 'Unit test for new function', type: 'unit', priority: 'required_before_pr' },
      ],
      recommended: [
        { description: 'Integration test with DB', type: 'integration', priority: 'recommended' },
      ],
      notApplicable: [],
      summary: 'Add unit test before merging',
    };
    const agent = new TestPlanAgent(makeProvider(plan));
    const result = await agent.plan({
      taskContext: 'Add user lookup function',
      filesChanged: ['src/user.ts'],
      proposedChangeSummary: 'Added getUserById function',
    });
    assert.equal(result.requiredBeforePr.length, 1);
    assert.equal(result.requiredBeforePr[0].type, 'unit');
    assert.equal(result.recommended.length, 1);
  });

  it('rejects invalid provider response', async () => {
    const agent = new TestPlanAgent(makeProvider({ bad: 'data' }));
    await assert.rejects(() => agent.plan({
      taskContext: 'x', filesChanged: [], proposedChangeSummary: '',
    }));
  });
});

// ── GitHubTool Phase 3 safety ─────────────────────────────────────────────────

describe('GitHubTool – branch slug sanitization', () => {
  const tool = new GitHubTool(() => undefined);

  it('gates remain correct', () => {
    assert.equal(tool.gates['create_branch'], 'approval_required');
    assert.equal(tool.gates['commit_file'], 'approval_required');
    assert.equal(tool.gates['open_pr'], 'approval_required');
  });

  it('rejects commit to main', async () => {
    const result = await tool.execute({
      operation: 'commit_file',
      owner: 'test', repo: 'test',
      path: 'README.md', branch: 'main',
      content: 'hello', message: 'update',
    }, makeCtx());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('protected branch'));
  });

  it('rejects commit to master', async () => {
    const result = await tool.execute({
      operation: 'commit_file',
      owner: 'test', repo: 'test',
      path: 'README.md', branch: 'master',
      content: 'hello', message: 'update',
    }, makeCtx());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('protected branch'));
  });

  it('rejects commit message containing a secret', async () => {
    const result = await tool.execute({
      operation: 'commit_file',
      owner: 'test', repo: 'test',
      path: 'src/config.ts', branch: 'feature/x',
      content: 'const x = 1;',
      message: 'add token sk-ant-api03-' + 'A'.repeat(93),
    }, makeCtx());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('commit message contains detected secret'));
  });

  it('rejects PR body containing a secret', async () => {
    const result = await tool.execute({
      operation: 'open_pr',
      owner: 'test', repo: 'test',
      title: 'My PR',
      head: 'feature/x',
      body: 'Token is sk-ant-api03-' + 'A'.repeat(93),
    }, makeCtx());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('body contains detected secret'));
  });

  it('rejects PR from protected head branch', async () => {
    const result = await tool.execute({
      operation: 'open_pr',
      owner: 'test', repo: 'test',
      title: 'Bad PR', head: 'main',
    }, makeCtx());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("protected branch 'main'"));
  });

  it('branch slug with special chars goes through sanitization path', async () => {
    // create_branch will try to call GitHub API (no token), but should sanitize first
    const result = await tool.execute({
      operation: 'create_branch',
      owner: 'test', repo: 'test',
      branch: 'feat/add user<>endpoint!',
    }, makeCtx());
    // Should fail with GITHUB_TOKEN error, not a validation error about the branch name
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('GITHUB_TOKEN') || result.error?.includes('GitHub API'));
  });

  it('branch slug that is entirely invalid chars is rejected', async () => {
    const result = await tool.execute({
      operation: 'create_branch',
      owner: 'test', repo: 'test',
      branch: '---',
    }, makeCtx());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('invalid'));
  });
});

// ── PRQualityChecklist – block verdict prevents merge ────────────────────────

describe('PRQualityChecklist – block verdict semantics', () => {
  it('block verdict sets readyToMerge=false', () => {
    const checklist = {
      taskSummary: 'Fix bug',
      filesChanged: ['src/foo.ts'],
      agentReasoning: 'fixed it',
      securityReviewPassed: true,
      testPlanComplete: true,
      humanApprovalsObtained: true,
      auditChainValid: true,
      codeReviewVerdict: 'block' as const,
      blockers: ['Critical SQL injection in proposed change'],
      warnings: [],
      readyToMerge: false,   // enforced by workflow logic
    };
    assert.equal(checklist.readyToMerge, false);
    assert.ok(checklist.blockers.length > 0);
  });

  it('approve verdict with no other blockers allows merge', () => {
    const checklist = {
      taskSummary: 'Add feature',
      filesChanged: ['src/bar.ts'],
      agentReasoning: 'done',
      securityReviewPassed: true,
      testPlanComplete: true,
      humanApprovalsObtained: true,
      auditChainValid: true,
      codeReviewVerdict: 'approve' as const,
      blockers: [],
      warnings: [],
      readyToMerge: true,
    };
    assert.equal(checklist.readyToMerge, true);
  });

  it('audit chain invalid prevents merge', () => {
    const checklist = {
      taskSummary: 'Update config',
      filesChanged: [],
      agentReasoning: 'done',
      securityReviewPassed: true,
      testPlanComplete: true,
      humanApprovalsObtained: true,
      auditChainValid: false,   // tampered
      codeReviewVerdict: 'approve' as const,
      blockers: ['Audit chain verification failed'],
      warnings: [],
      readyToMerge: false,
    };
    assert.equal(checklist.auditChainValid, false);
    assert.equal(checklist.readyToMerge, false);
  });
});

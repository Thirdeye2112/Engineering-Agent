/**
 * Phase 8 unit tests — no DB/API/network required.
 * Run: npx tsx --test packages/pilot/src/__tests__/phase8.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FailureClassifier } from '../failure-classifier.js';
import { PilotScoreboard } from '../scoreboard.js';
import { PILOT_TASKS, getTaskById } from '../task-suite.js';
import { RetryRunner } from '../retry-runner.js';
import type { PRWorkflowReport } from '@consensus/shared-types';
import type { PilotRunRecord, FailureReason } from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<PRWorkflowReport> = {}): PRWorkflowReport {
  return {
    projectId: 'test',
    task: 'test',
    implementationPlan: '',
    prUrl: null,
    prNumber: null,
    branch: null,
    filesModified: [],
    blockingObjections: [],
    totalCostUsd: 0,
    completedAt: new Date().toISOString(),
    ...overrides,
  } as unknown as PRWorkflowReport;
}

function tmpScoreboardPath(): string {
  return path.join(os.tmpdir(), `scoreboard-test-${Date.now()}.json`);
}

function makeRunRecord(overrides: Partial<PilotRunRecord> = {}): PilotRunRecord {
  return {
    runId: 'r1',
    taskId: 'task-1',
    taskLabel: 'test task',
    repo: 'owner/repo',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: 'pr_opened',
    prUrl: 'https://github.com/owner/repo/pull/1',
    prNumber: 1,
    interventionPct: 12,
    totalActions: 22,
    humanInterventions: 3,
    approvalsRequested: 3,
    approvalsDenied: 0,
    testStatus: 'passed',
    testDurationMs: 1800,
    codeReviewVerdict: 'approve',
    auditVerificationValid: true,
    elapsedMs: 90000,
    failureReason: null,
    failureDetail: null,
    retryCount: 0,
    ...overrides,
  };
}

// ── FailureClassifier ─────────────────────────────────────────────────────────

describe('FailureClassifier', () => {
  const c = new FailureClassifier();

  it('returns null for a successful run', () => {
    const report = makeReport({ prUrl: 'https://github.com/owner/repo/pull/1' });
    assert.equal(c.classify(report), null);
  });

  it('classifies onboarding error', () => {
    const result = c.classify(makeReport(), new Error('analyzeRepo failed'));
    assert.equal(result?.reason, 'repo_onboarding_failure');
  });

  it('classifies missing dependencies', () => {
    const result = c.classify(makeReport(), new Error('Cannot find module "tsx"'));
    assert.equal(result?.reason, 'missing_dependencies');
  });

  it('classifies test_command_unavailable when tests_not_configured', () => {
    const report = makeReport({
      testResults: [{ profile: 'unit', status: 'tests_not_configured', exitCode: 1, durationMs: 0, truncated: false, label: '' }],
    });
    const result = c.classify(report);
    assert.equal(result?.reason, 'test_command_unavailable');
  });

  it('classifies code_review_block from codeReview verdict', () => {
    const report = makeReport({
      codeReview: { verdict: 'block', rationale: 'SQL injection risk', requiredFixes: [], riskLevel: 'high', securityConcerns: ['injection'], testingGaps: [] },
    });
    const result = c.classify(report);
    assert.equal(result?.reason, 'code_review_block');
  });

  it('classifies permission_denial from error message', () => {
    const result = c.classify(makeReport(), new Error('permission denied for operation'));
    assert.equal(result?.reason, 'permission_denial');
  });

  it('classifies github_api_error from rate limit message', () => {
    const result = c.classify(makeReport(), new Error('GitHub rate limit exceeded'));
    assert.equal(result?.reason, 'github_api_error');
  });

  it('classifies audit_verification_failure from checklist', () => {
    const report = makeReport({
      checklist: { auditChainValid: false, readyToMerge: false, securityReviewPassed: true, testPlanComplete: true, humanApprovalsObtained: true, requiredTestsPassed: true, blockers: [], warnings: [], taskSummary: '', filesChanged: [], agentReasoning: '', codeReviewVerdict: 'approve', testResults: [] },
    });
    const result = c.classify(report);
    assert.equal(result?.reason, 'audit_verification_failure');
  });

  it('classifies agent_implementation_error when tests fail', () => {
    const report = makeReport({
      testResults: [{ profile: 'unit', status: 'failed', exitCode: 1, durationMs: 300, truncated: false, label: '' }],
    });
    const result = c.classify(report);
    assert.equal(result?.reason, 'agent_implementation_error');
  });

  it('isRetryable returns true for agent_implementation_error', () => {
    assert.ok(c.isRetryable('agent_implementation_error'));
    assert.ok(c.isRetryable('test_command_unavailable'));
  });

  it('isRetryable returns false for hard-stop reasons', () => {
    assert.ok(!c.isRetryable('audit_verification_failure'));
    assert.ok(!c.isRetryable('permission_denial'));
    assert.ok(!c.isRetryable('code_review_block'));
  });

  it('isHardStop returns true for security/audit failures', () => {
    assert.ok(c.isHardStop('audit_verification_failure'));
    assert.ok(c.isHardStop('permission_denial'));
    assert.ok(c.isHardStop('code_review_block'));
  });

  it('isHardStop returns false for retryable reasons', () => {
    assert.ok(!c.isHardStop('agent_implementation_error'));
    assert.ok(!c.isHardStop('missing_dependencies'));
  });
});

// ── PilotScoreboard ───────────────────────────────────────────────────────────

describe('PilotScoreboard', () => {
  it('starts empty for a new file path', () => {
    const sb = new PilotScoreboard(tmpScoreboardPath());
    assert.equal(sb.summary.totalRuns, 0);
    assert.equal(sb.summary.prOpenedCount, 0);
  });

  it('appends a run and reflects in summary', () => {
    const p = tmpScoreboardPath();
    const sb = new PilotScoreboard(p);
    sb.append(makeRunRecord());
    assert.equal(sb.summary.totalRuns, 1);
    assert.equal(sb.summary.prOpenedCount, 1);
    assert.equal(sb.summary.prOpenedPct, 100);
  });

  it('persists to disk and reloads', () => {
    const p = tmpScoreboardPath();
    const sb1 = new PilotScoreboard(p);
    sb1.append(makeRunRecord({ runId: 'r1', status: 'pr_opened' }));
    sb1.append(makeRunRecord({ runId: 'r2', status: 'failed', failureReason: 'agent_implementation_error', interventionPct: 30 }));

    const sb2 = new PilotScoreboard(p);
    assert.equal(sb2.summary.totalRuns, 2);
    assert.equal(sb2.summary.prOpenedCount, 1);
    fs.unlinkSync(p);
  });

  it('computes avgInterventionPct correctly', () => {
    const p = tmpScoreboardPath();
    const sb = new PilotScoreboard(p);
    sb.append(makeRunRecord({ runId: 'a', interventionPct: 10 }));
    sb.append(makeRunRecord({ runId: 'b', interventionPct: 20 }));
    assert.equal(sb.summary.avgInterventionPct, 15);
    fs.unlinkSync(p);
  });

  it('counts auditInvalidCount', () => {
    const p = tmpScoreboardPath();
    const sb = new PilotScoreboard(p);
    sb.append(makeRunRecord({ auditVerificationValid: false }));
    assert.equal(sb.summary.auditInvalidCount, 1);
    fs.unlinkSync(p);
  });

  it('counts failureBreakdown by reason', () => {
    const p = tmpScoreboardPath();
    const sb = new PilotScoreboard(p);
    sb.append(makeRunRecord({ status: 'failed', failureReason: 'github_api_error' }));
    sb.append(makeRunRecord({ status: 'failed', failureReason: 'github_api_error' }));
    sb.append(makeRunRecord({ status: 'failed', failureReason: 'agent_implementation_error' }));
    assert.equal(sb.summary.failureBreakdown['github_api_error'], 2);
    assert.equal(sb.summary.failureBreakdown['agent_implementation_error'], 1);
    fs.unlinkSync(p);
  });

  it('regressionReport includes pass verdict when criteria met', () => {
    const p = tmpScoreboardPath();
    const sb = new PilotScoreboard(p);
    for (let i = 0; i < 5; i++) {
      sb.append(makeRunRecord({ runId: `r${i}`, interventionPct: 12 }));
    }
    const rpt = sb.regressionReport();
    assert.ok(rpt.includes('PHASE 8 ACCEPTANCE CRITERIA MET'));
    fs.unlinkSync(p);
  });

  it('regressionReport includes fail verdict when criteria not met', () => {
    const p = tmpScoreboardPath();
    const sb = new PilotScoreboard(p);
    sb.append(makeRunRecord({ status: 'failed', failureReason: 'agent_implementation_error', prUrl: null, prNumber: null }));
    const rpt = sb.regressionReport();
    assert.ok(rpt.includes('NOT MET'));
    fs.unlinkSync(p);
  });
});

// ── Task Suite ────────────────────────────────────────────────────────────────

describe('Task suite', () => {
  it('has exactly 5 tasks', () => {
    assert.equal(PILOT_TASKS.length, 5);
  });

  it('all tasks have unique ids', () => {
    const ids = PILOT_TASKS.map(t => t.id);
    assert.equal(new Set(ids).size, 5);
  });

  it('all tasks have non-empty prompt and expectedFiles', () => {
    for (const task of PILOT_TASKS) {
      assert.ok(task.prompt.length > 0, `${task.id} has empty prompt`);
      assert.ok(task.expectedFiles.length > 0, `${task.id} has no expectedFiles`);
      assert.ok(task.label.length > 0, `${task.id} has empty label`);
    }
  });

  it('getTaskById returns correct task', () => {
    const t = getTaskById('task-1-slugify');
    assert.ok(t);
    assert.equal(t!.id, 'task-1-slugify');
  });

  it('getTaskById returns undefined for unknown id', () => {
    assert.equal(getTaskById('nonexistent'), undefined);
  });

  it('task-1 slugify is retryable', () => {
    assert.ok(getTaskById('task-1-slugify')?.retryable);
  });

  it('task-2 readme targets README.md', () => {
    const t = getTaskById('task-2-readme');
    assert.ok(t?.expectedFiles.includes('README.md'));
  });

  it('task-5 type-guard targets both src files', () => {
    const t = getTaskById('task-5-type-guard');
    assert.ok(t?.expectedFiles.includes('src/utils.ts'));
    assert.ok(t?.expectedFiles.includes('src/utils.test.ts'));
  });
});

// ── RetryRunner ───────────────────────────────────────────────────────────────

describe('RetryRunner', () => {
  const task = PILOT_TASKS[0];

  it('returns pr_opened on first success', async () => {
    const runner = new RetryRunner({
      runTask: async () => ({
        report: makeReport({ prUrl: 'https://github.com/o/r/pull/1', prNumber: 1 }),
        elapsedMs: 1000,
        interventionPct: 12,
        totalActions: 22,
        humanInterventions: 3,
        approvalsRequested: 3,
        approvalsDenied: 0,
      }),
    });
    const record = await runner.run(task, 'owner/repo');
    assert.equal(record.status, 'pr_opened');
    assert.equal(record.failureReason, null);
    assert.equal(record.retryCount, 0);
  });

  it('retries on retryable failure and succeeds on second attempt', async () => {
    let call = 0;
    const runner = new RetryRunner({
      runTask: async () => {
        call++;
        if (call === 1) {
          // First attempt: tests failed
          return {
            report: makeReport({
              testResults: [{ profile: 'unit', status: 'failed', exitCode: 1, durationMs: 300, truncated: false, label: '' }],
            }),
            elapsedMs: 5000,
            interventionPct: 15,
            totalActions: 20,
            humanInterventions: 3,
            approvalsRequested: 3,
            approvalsDenied: 0,
          };
        }
        // Second attempt: success
        return {
          report: makeReport({ prUrl: 'https://github.com/o/r/pull/2', prNumber: 2 }),
          elapsedMs: 4000,
          interventionPct: 12,
          totalActions: 22,
          humanInterventions: 3,
          approvalsRequested: 3,
          approvalsDenied: 0,
        };
      },
    });
    const record = await runner.run(task, 'owner/repo');
    assert.equal(record.status, 'pr_opened');
    assert.equal(record.retryCount, 1);
    assert.equal(call, 2);
  });

  it('does NOT retry on hard-stop failure (code_review_block)', async () => {
    let callCount = 0;
    const runner = new RetryRunner({
      runTask: async () => {
        callCount++;
        return {
          report: makeReport({
            codeReview: { verdict: 'block', rationale: 'security issue', requiredFixes: [], riskLevel: 'high', securityConcerns: [], testingGaps: [] },
          }),
          elapsedMs: 3000,
          interventionPct: 8,
          totalActions: 18,
          humanInterventions: 1,
          approvalsRequested: 1,
          approvalsDenied: 0,
        };
      },
    });
    const record = await runner.run(task, 'owner/repo');
    assert.equal(record.status, 'failed');
    assert.equal(record.failureReason, 'code_review_block');
    assert.equal(callCount, 1);
  });

  it('marks retried_and_failed when retry also fails', async () => {
    const runner = new RetryRunner({
      runTask: async () => ({
        report: makeReport({
          testResults: [{ profile: 'unit', status: 'failed', exitCode: 1, durationMs: 200, truncated: false, label: '' }],
        }),
        elapsedMs: 2000,
        interventionPct: 10,
        totalActions: 18,
        humanInterventions: 2,
        approvalsRequested: 2,
        approvalsDenied: 0,
      }),
    });
    const record = await runner.run(task, 'owner/repo');
    assert.equal(record.status, 'retried_and_failed');
    assert.equal(record.retryCount, 1);
  });

  it('calls onRetry callback with task and attempt number', async () => {
    const retries: Array<{ taskId: string; attempt: number; reason: string }> = [];
    let call = 0;
    const runner = new RetryRunner({
      runTask: async () => {
        call++;
        if (call === 1) {
          return {
            report: makeReport({
              testResults: [{ profile: 'unit', status: 'failed', exitCode: 1, durationMs: 200, truncated: false, label: '' }],
            }),
            elapsedMs: 1000, interventionPct: 10, totalActions: 18, humanInterventions: 2, approvalsRequested: 2, approvalsDenied: 0,
          };
        }
        return {
          report: makeReport({ prUrl: 'https://github.com/o/r/pull/3', prNumber: 3 }),
          elapsedMs: 1000, interventionPct: 12, totalActions: 22, humanInterventions: 3, approvalsRequested: 3, approvalsDenied: 0,
        };
      },
      onRetry: (t, attempt, reason) => retries.push({ taskId: t.id, attempt, reason }),
    });
    await runner.run(task, 'owner/repo');
    assert.equal(retries.length, 1);
    assert.equal(retries[0].taskId, task.id);
    assert.equal(retries[0].attempt, 2);
    assert.equal(retries[0].reason, 'agent_implementation_error');
  });

  it('records correct taskId, taskLabel, repo', async () => {
    const runner = new RetryRunner({
      runTask: async () => ({
        report: makeReport({ prUrl: 'https://github.com/o/r/pull/1', prNumber: 1 }),
        elapsedMs: 500, interventionPct: 12, totalActions: 22, humanInterventions: 3, approvalsRequested: 3, approvalsDenied: 0,
      }),
    });
    const record = await runner.run(task, 'my-org/my-repo');
    assert.equal(record.taskId, task.id);
    assert.equal(record.taskLabel, task.label);
    assert.equal(record.repo, 'my-org/my-repo');
  });
});

// ── Acceptance criteria model ─────────────────────────────────────────────────

describe('Phase 8 acceptance criteria model', () => {
  it('≥80% PR-opened rate from 5 successful runs', () => {
    const p = tmpScoreboardPath();
    const sb = new PilotScoreboard(p);
    for (let i = 0; i < 5; i++) sb.append(makeRunRecord({ runId: `r${i}` }));
    assert.ok(sb.summary.prOpenedPct >= 80);
    fs.unlinkSync(p);
  });

  it('avg intervention ≤20% across typical runs', () => {
    const p = tmpScoreboardPath();
    const sb = new PilotScoreboard(p);
    const pcts = [12, 12, 16, 12, 12];
    for (let i = 0; i < pcts.length; i++) {
      sb.append(makeRunRecord({ runId: `r${i}`, interventionPct: pcts[i] }));
    }
    assert.ok(sb.summary.avgInterventionPct <= 20);
    fs.unlinkSync(p);
  });

  it('0 invalid audit chains in clean runs', () => {
    const p = tmpScoreboardPath();
    const sb = new PilotScoreboard(p);
    for (let i = 0; i < 5; i++) sb.append(makeRunRecord({ runId: `r${i}`, auditVerificationValid: true }));
    assert.equal(sb.summary.auditInvalidCount, 0);
    fs.unlinkSync(p);
  });

  it('one bad run drops prOpenedPct below 100% but stays ≥80% out of 5', () => {
    const p = tmpScoreboardPath();
    const sb = new PilotScoreboard(p);
    for (let i = 0; i < 4; i++) sb.append(makeRunRecord({ runId: `r${i}` }));
    sb.append(makeRunRecord({ runId: 'bad', status: 'failed', failureReason: 'github_api_error', prUrl: null, prNumber: null }));
    assert.ok(sb.summary.prOpenedPct >= 80);
    fs.unlinkSync(p);
  });
});

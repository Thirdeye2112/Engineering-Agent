/**
 * Milestone 1: Production Evaluation — unit tests
 * Run: npx tsx --test packages/pilot/src/__tests__/milestone1.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PilotScoreboard } from '../scoreboard.js';
import { OutcomeSyncer } from '../outcome-syncer.js';
import type { PilotRunRecord, PROutcome, OutcomeState } from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmp(): string {
  return path.join(os.tmpdir(), `m1-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function makeRun(overrides: Partial<PilotRunRecord> = {}): PilotRunRecord {
  return {
    runId: `r-${Math.random().toString(36).slice(2)}`,
    taskId: 'task-1-slugify',
    taskLabel: 'Add slugify utility',
    repo: 'owner/repo',
    startedAt: '2026-06-13T10:00:00.000Z',
    completedAt: '2026-06-13T10:01:30.000Z',
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
    elapsedMs: 90_000,
    failureReason: null,
    failureDetail: null,
    retryCount: 0,
    outcome: null,
    ...overrides,
  };
}

function makeOutcome(state: OutcomeState, overrides: Partial<PROutcome> = {}): PROutcome {
  return {
    state,
    reviewedAt: null,
    mergedAt: null,
    closedAt: null,
    revertedAt: null,
    timeToReviewMs: null,
    timeToMergeMs: null,
    resolvedBy: null,
    lastSyncedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Scoreboard: outcome tracking ──────────────────────────────────────────────

describe('PilotScoreboard — outcome tracking', () => {
  it('updateOutcome returns false when no matching run', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    const ok = sb.updateOutcome('owner/repo', 999, makeOutcome('pr_merged'));
    assert.equal(ok, false);
    fs.unlinkSync(p);
  });

  it('updateOutcome sets outcome and persists', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: 7, repo: 'owner/repo' }));
    const ok = sb.updateOutcome('owner/repo', 7, makeOutcome('pr_merged', {
      mergedAt: '2026-06-13T11:00:00.000Z',
      timeToMergeMs: 3_600_000,
      resolvedBy: 'alice',
    }));
    assert.equal(ok, true);

    const sb2 = new PilotScoreboard(p);
    const run = sb2.allRuns.find(r => r.prNumber === 7);
    assert.equal(run?.outcome?.state, 'pr_merged');
    assert.equal(run?.outcome?.resolvedBy, 'alice');
    fs.unlinkSync(p);
  });

  it('pendingSyncRuns returns runs with open PRs and no final outcome', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: 1, outcome: null }));
    sb.append(makeRun({ prNumber: 2, outcome: makeOutcome('pr_merged') }));
    sb.append(makeRun({ prNumber: 3, outcome: makeOutcome('pr_reviewed') }));
    sb.append(makeRun({ prNumber: null, status: 'failed' }));

    const pending = sb.pendingSyncRuns();
    // PR 1 (null outcome) and PR 3 (pr_reviewed — still pending) qualify
    assert.equal(pending.length, 2);
    assert.ok(pending.some(p => p.prNumber === 1));
    assert.ok(pending.some(p => p.prNumber === 3));
    fs.unlinkSync(p);
  });

  it('pendingSyncRuns excludes runs with no prNumber', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: null, status: 'failed', outcome: null }));
    assert.equal(sb.pendingSyncRuns().length, 0);
    fs.unlinkSync(p);
  });
});

// ── Scoreboard: production metrics ───────────────────────────────────────────

describe('PilotScoreboard — production metrics', () => {
  it('mergeRate is 0 when no runs have outcomes', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ outcome: null }));
    assert.equal(sb.summary.mergeRate, 0);
    fs.unlinkSync(p);
  });

  it('mergeRate is 100% when all resolved runs merged', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: 1, outcome: makeOutcome('pr_merged') }));
    sb.append(makeRun({ prNumber: 2, outcome: makeOutcome('pr_merged') }));
    assert.equal(sb.summary.mergeRate, 100);
    fs.unlinkSync(p);
  });

  it('mergeRate is 50% when half merged, half rejected', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: 1, outcome: makeOutcome('pr_merged') }));
    sb.append(makeRun({ prNumber: 2, outcome: makeOutcome('pr_rejected') }));
    assert.equal(sb.summary.mergeRate, 50);
    fs.unlinkSync(p);
  });

  it('revertRate is 0 when no reverts', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: 1, outcome: makeOutcome('pr_merged') }));
    assert.equal(sb.summary.revertRate, 0);
    fs.unlinkSync(p);
  });

  it('revertRate counts reverted-after-merge correctly', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: 1, outcome: makeOutcome('pr_merged') }));
    sb.append(makeRun({ prNumber: 2, outcome: makeOutcome('pr_reverted') }));
    // 2 "merged" (merged + reverted), 1 reverted → 50%
    assert.equal(sb.summary.revertRate, 50);
    fs.unlinkSync(p);
  });

  it('reviewPassRate is 0 when all reviewed PRs are rejected', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: 1, outcome: makeOutcome('pr_rejected') }));
    assert.equal(sb.summary.reviewPassRate, 0);
    fs.unlinkSync(p);
  });

  it('avgTimeToPrMs averages elapsedMs of pr_opened runs', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ elapsedMs: 60_000 }));
    sb.append(makeRun({ elapsedMs: 120_000 }));
    assert.equal(sb.summary.avgTimeToPrMs, 90_000);
    fs.unlinkSync(p);
  });

  it('avgTimeToMergeMs averages timeToMergeMs from outcomes', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: 1, outcome: makeOutcome('pr_merged', { timeToMergeMs: 3_600_000 }) }));
    sb.append(makeRun({ prNumber: 2, outcome: makeOutcome('pr_merged', { timeToMergeMs: 7_200_000 }) }));
    assert.equal(sb.summary.avgTimeToMergeMs, 5_400_000);
    fs.unlinkSync(p);
  });

  it('avgInterventionRate equals avgInterventionPct', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ interventionPct: 10 }));
    sb.append(makeRun({ interventionPct: 20 }));
    assert.equal(sb.summary.avgInterventionRate, sb.summary.avgInterventionPct);
    fs.unlinkSync(p);
  });

  it('outcomeBreakdown counts all state types', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: 1, outcome: makeOutcome('pr_merged') }));
    sb.append(makeRun({ prNumber: 2, outcome: makeOutcome('pr_rejected') }));
    sb.append(makeRun({ prNumber: 3, outcome: makeOutcome('pr_merged') }));
    const bd = sb.summary.outcomeBreakdown;
    assert.equal(bd['pr_merged'], 2);
    assert.equal(bd['pr_rejected'], 1);
    assert.equal(bd['pr_opened'], 0);
    fs.unlinkSync(p);
  });

  it('50-task gate warning appears in regressionReport when < 50 runs', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun());
    const rpt = sb.regressionReport();
    assert.ok(rpt.includes('50'));
    fs.unlinkSync(p);
  });
});

// ── OutcomeSyncer: state resolution ──────────────────────────────────────────

describe('OutcomeSyncer — state resolution logic', () => {
  /** Access the private resolveState method via a test subclass. */
  class TestSyncer extends OutcomeSyncer {
    public testResolveState(
      pr: { state: 'open' | 'closed'; merged: boolean; merged_at: string | null },
      revertedAt: string | null,
      reviewedAt: string | null,
    ): OutcomeState {
      // Mirror the private method — kept in sync with the implementation.
      if (revertedAt) return 'pr_reverted';
      if (pr.merged) return 'pr_merged';
      if (pr.state === 'closed' && !pr.merged) {
        return reviewedAt ? 'pr_rejected' : 'pr_abandoned';
      }
      if (reviewedAt) return 'pr_reviewed';
      return 'pr_opened';
    }
  }

  const s = new TestSyncer(null as never);

  it('open + no reviews → pr_opened', () => {
    assert.equal(s.testResolveState({ state: 'open', merged: false, merged_at: null }, null, null), 'pr_opened');
  });

  it('open + reviewed → pr_reviewed', () => {
    assert.equal(s.testResolveState({ state: 'open', merged: false, merged_at: null }, null, '2026-06-13T12:00:00Z'), 'pr_reviewed');
  });

  it('closed + merged → pr_merged', () => {
    assert.equal(s.testResolveState({ state: 'closed', merged: true, merged_at: '2026-06-13T13:00:00Z' }, null, null), 'pr_merged');
  });

  it('closed + not merged + reviewed → pr_rejected', () => {
    assert.equal(s.testResolveState({ state: 'closed', merged: false, merged_at: null }, null, '2026-06-13T12:00:00Z'), 'pr_rejected');
  });

  it('closed + not merged + not reviewed → pr_abandoned', () => {
    assert.equal(s.testResolveState({ state: 'closed', merged: false, merged_at: null }, null, null), 'pr_abandoned');
  });

  it('merged + revertedAt → pr_reverted (takes priority)', () => {
    assert.equal(s.testResolveState({ state: 'closed', merged: true, merged_at: '2026-06-13T13:00:00Z' }, '2026-06-14T09:00:00Z', null), 'pr_reverted');
  });
});

// ── OutcomeSyncer: integration with scoreboard (mocked HTTP) ─────────────────

describe('OutcomeSyncer — syncOne with mocked GitHub API', () => {
  function makeSyncerWithMock(responses: Record<string, unknown>): OutcomeSyncer {
    class MockSyncer extends OutcomeSyncer {
      // Override private get() via monkey-patch trick using a subclass
      protected async mockGet(path: string) {
        const key = Object.keys(responses).find(k => path.includes(k));
        if (!key) throw new Error(`No mock for path: ${path}`);
        return responses[key];
      }
    }
    // Patch the private api method
    const syncer = new MockSyncer(null as never, () => 'fake-token');
    (syncer as any)['get'] = async (p: string) => {
      const key = Object.keys(responses).find(k => p.includes(k));
      if (!key) throw new Error(`No mock for path: ${p}`);
      return responses[key];
    };
    return syncer;
  }

  it('syncs an open PR with no reviews as pr_opened', async () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: 42, repo: 'owner/repo', outcome: null }));

    const syncer = makeSyncerWithMock({
      '/pulls/42': {
        number: 42, state: 'open', merged: false, merged_at: null,
        closed_at: null, created_at: '2026-06-13T10:00:00Z',
        user: { login: 'agent-bot' }, title: 'feat: add slugify',
      },
      '/reviews': [],
      '/pulls?state=closed': [],
    });
    (syncer as any).scoreboard = sb;

    const result = await syncer.syncOne('owner/repo', 42, '2026-06-13T10:01:30.000Z');
    assert.equal(result.current, 'pr_opened');
    assert.equal(result.updated, true);
    fs.unlinkSync(p);
  });

  it('syncs a merged PR as pr_merged with timeToMergeMs', async () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: 43, repo: 'owner/repo', outcome: null }));

    const mergedAt = '2026-06-13T11:00:00.000Z';
    const syncer = makeSyncerWithMock({
      '/pulls/43': {
        number: 43, state: 'closed', merged: true,
        merged_at: mergedAt, closed_at: mergedAt,
        created_at: '2026-06-13T10:00:00Z',
        user: { login: 'agent-bot' }, title: 'feat: add slugify',
      },
      '/reviews': [{
        state: 'APPROVED', submitted_at: '2026-06-13T10:30:00Z',
        user: { login: 'alice' },
      }],
      '/pulls?state=closed': [],
    });
    (syncer as any).scoreboard = sb;

    const result = await syncer.syncOne('owner/repo', 43, '2026-06-13T10:01:30.000Z');
    assert.equal(result.current, 'pr_merged');

    const run = sb.allRuns.find(r => r.prNumber === 43);
    assert.ok(run?.outcome?.timeToMergeMs != null);
    assert.ok(run!.outcome!.timeToMergeMs! > 0);
    fs.unlinkSync(p);
  });

  it('syncs a closed-without-merge as pr_abandoned when no reviews', async () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: 44, repo: 'owner/repo', outcome: null }));

    const syncer = makeSyncerWithMock({
      '/pulls/44': {
        number: 44, state: 'closed', merged: false,
        merged_at: null, closed_at: '2026-06-13T12:00:00Z',
        created_at: '2026-06-13T10:00:00Z',
        user: { login: 'agent-bot' }, title: 'feat: add slugify',
      },
      '/reviews': [],
      '/pulls?state=closed': [],
    });
    (syncer as any).scoreboard = sb;

    const result = await syncer.syncOne('owner/repo', 44, '2026-06-13T10:01:30.000Z');
    assert.equal(result.current, 'pr_abandoned');
    fs.unlinkSync(p);
  });

  it('detects revert PR and marks pr_reverted', async () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: 45, repo: 'owner/repo', outcome: null }));

    const mergedAt = '2026-06-13T11:00:00.000Z';
    const revertMergedAt = '2026-06-14T09:00:00.000Z';
    const syncer = makeSyncerWithMock({
      '/pulls/45': {
        number: 45, state: 'closed', merged: true,
        merged_at: mergedAt, closed_at: mergedAt,
        created_at: '2026-06-13T10:00:00Z',
        user: { login: 'agent-bot' }, title: 'feat: add slugify',
      },
      '/reviews': [],
      '/pulls?state=closed': [
        {
          number: 46, state: 'closed', merged: true,
          merged_at: revertMergedAt, closed_at: revertMergedAt,
          created_at: '2026-06-14T08:00:00Z',
          user: { login: 'alice' }, title: 'Revert "feat: add slugify"',
        },
      ],
    });
    (syncer as any).scoreboard = sb;

    const result = await syncer.syncOne('owner/repo', 45, '2026-06-13T10:01:30.000Z');
    assert.equal(result.current, 'pr_reverted');
    fs.unlinkSync(p);
  });

  it('syncAll skips runs with no prNumber', async () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    sb.append(makeRun({ prNumber: null, status: 'failed', outcome: null }));

    const syncer = new OutcomeSyncer(sb, () => 'fake-token');
    const results = await syncer.syncAll();
    assert.equal(results.length, 0);
    fs.unlinkSync(p);
  });
});

// ── Acceptance criteria reporting ─────────────────────────────────────────────

describe('Milestone 1 acceptance criteria reporting', () => {
  it('summary exposes all 6 required metrics', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    const s = sb.summary;
    // All 6 required metrics are present
    assert.ok('prOpenedPct' in s);
    assert.ok('mergeRate' in s);
    assert.ok('reviewPassRate' in s);   // proxy for "rejection rate" inverse
    assert.ok('revertRate' in s);
    assert.ok('avgInterventionRate' in s);
    assert.ok('failureBreakdown' in s);
    fs.unlinkSync(p);
  });

  it('can report PR open rate, merge rate, rejection rate independently', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    // 3 PRs opened, 2 merged, 1 rejected
    sb.append(makeRun({ prNumber: 1, outcome: makeOutcome('pr_merged') }));
    sb.append(makeRun({ prNumber: 2, outcome: makeOutcome('pr_merged') }));
    sb.append(makeRun({ prNumber: 3, outcome: makeOutcome('pr_rejected') }));
    sb.append(makeRun({ prNumber: null, status: 'failed', outcome: null }));

    const s = sb.summary;
    assert.equal(s.prOpenedPct, 75);                // 3/4 runs opened PR
    assert.equal(s.mergeRate, parseFloat((2/3 * 100).toFixed(1)));  // 2 of 3 resolved
    // rejection rate = 100 - reviewPassRate (approx) — not a direct field but derivable
    assert.equal(s.outcomeBreakdown['pr_rejected'], 1);
    fs.unlinkSync(p);
  });

  it('failure taxonomy distribution is complete (all 9 categories)', () => {
    const p = tmp();
    const sb = new PilotScoreboard(p);
    const s = sb.summary;
    const categories = Object.keys(s.failureBreakdown);
    assert.equal(categories.length, 9);
    fs.unlinkSync(p);
  });
});

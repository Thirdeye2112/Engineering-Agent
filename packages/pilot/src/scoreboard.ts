import * as fs from 'node:fs';
import type { PilotRunRecord, ScoreboardSummary, FailureReason, PROutcome, OutcomeState } from './types.js';

const FAILURE_REASONS: FailureReason[] = [
  'repo_onboarding_failure',
  'missing_dependencies',
  'test_command_unavailable',
  'agent_implementation_error',
  'code_review_block',
  'permission_denial',
  'github_api_error',
  'audit_verification_failure',
  'memory_repo_intelligence_mismatch',
];

const OUTCOME_STATES: OutcomeState[] = [
  'pr_opened',
  'pr_reviewed',
  'pr_merged',
  'pr_rejected',
  'pr_abandoned',
  'pr_reverted',
];

export class PilotScoreboard {
  private runs: PilotRunRecord[] = [];

  constructor(private readonly filePath: string) {
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        this.runs = Array.isArray(data.runs) ? data.runs : [];
      } catch {
        this.runs = [];
      }
    }
  }

  append(record: PilotRunRecord): void {
    this.runs.push(record);
    this.flush();
  }

  /**
   * Update the outcome for a run identified by prNumber + repo.
   * Called by OutcomeSyncer after polling GitHub PR state.
   */
  updateOutcome(repo: string, prNumber: number, outcome: PROutcome): boolean {
    const run = this.runs.find(r => r.repo === repo && r.prNumber === prNumber);
    if (!run) return false;
    run.outcome = outcome;
    this.flush();
    return true;
  }

  /** Find runs that have a PR opened but no resolved outcome yet. */
  pendingSyncRuns(): Array<{ runId: string; repo: string; prNumber: number; prOpenedAt: string }> {
    return this.runs
      .filter(r =>
        r.prNumber !== null &&
        r.repo &&
        (r.outcome === null || r.outcome?.state === 'pr_opened' || r.outcome?.state === 'pr_reviewed'),
      )
      .map(r => ({
        runId: r.runId,
        repo: r.repo,
        prNumber: r.prNumber!,
        prOpenedAt: r.completedAt,
      }));
  }

  get summary(): ScoreboardSummary {
    const prOpened = this.runs.filter(r => r.status === 'pr_opened' || r.status === 'retried_and_passed');
    const avgIntervention = this.runs.length
      ? this.runs.reduce((s, r) => s + r.interventionPct, 0) / this.runs.length
      : 0;
    const maxIntervention = this.runs.length
      ? Math.max(...this.runs.map(r => r.interventionPct))
      : 0;

    const breakdown: Record<FailureReason, number> = {} as Record<FailureReason, number>;
    for (const r of FAILURE_REASONS) breakdown[r] = 0;
    for (const run of this.runs) {
      if (run.failureReason) breakdown[run.failureReason] = (breakdown[run.failureReason] ?? 0) + 1;
    }

    // ── Outcome metrics ─────────────────────────────────────────────────────

    const outcomeBreakdown: Record<OutcomeState, number> = {} as Record<OutcomeState, number>;
    for (const s of OUTCOME_STATES) outcomeBreakdown[s] = 0;

    const runsWithOutcome = this.runs.filter(r => r.outcome !== null);
    for (const run of runsWithOutcome) {
      const state = run.outcome!.state;
      outcomeBreakdown[state] = (outcomeBreakdown[state] ?? 0) + 1;
    }

    const mergedCount = outcomeBreakdown['pr_merged'] + outcomeBreakdown['pr_reverted'];
    const resolvedCount = mergedCount + outcomeBreakdown['pr_rejected'] + outcomeBreakdown['pr_abandoned'];
    const reviewedCount = runsWithOutcome.filter(r =>
      r.outcome!.state !== 'pr_opened',
    ).length;
    const revertedCount = outcomeBreakdown['pr_reverted'];

    const mergeRate = resolvedCount > 0 ? (mergedCount / resolvedCount) * 100 : 0;
    const reviewPassRate = reviewedCount > 0 ? (mergedCount / reviewedCount) * 100 : 0;
    const revertRate = mergedCount > 0 ? (revertedCount / mergedCount) * 100 : 0;

    // avgTimeToPR: elapsedMs is time from run start to PR open
    const runsWithPr = prOpened.filter(r => r.elapsedMs > 0);
    const avgTimeToPrMs = runsWithPr.length
      ? Math.round(runsWithPr.reduce((s, r) => s + r.elapsedMs, 0) / runsWithPr.length)
      : null;

    const mergedRuns = runsWithOutcome.filter(r => r.outcome!.timeToMergeMs !== null);
    const avgTimeToMergeMs = mergedRuns.length
      ? Math.round(mergedRuns.reduce((s, r) => s + r.outcome!.timeToMergeMs!, 0) / mergedRuns.length)
      : null;

    return {
      totalRuns: this.runs.length,
      prOpenedCount: prOpened.length,
      prOpenedPct: this.runs.length ? (prOpened.length / this.runs.length) * 100 : 0,
      avgInterventionPct: parseFloat(avgIntervention.toFixed(1)),
      maxInterventionPct: parseFloat(maxIntervention.toFixed(1)),
      passedThresholdCount: this.runs.filter(r => r.interventionPct <= 20).length,
      failedThresholdCount: this.runs.filter(r => r.interventionPct > 20).length,
      auditInvalidCount: this.runs.filter(r => !r.auditVerificationValid).length,
      unauthorizedWriteCount: this.runs.filter(r => r.failureReason === 'permission_denial').length,
      failureBreakdown: breakdown,
      mergeRate: parseFloat(mergeRate.toFixed(1)),
      reviewPassRate: parseFloat(reviewPassRate.toFixed(1)),
      revertRate: parseFloat(revertRate.toFixed(1)),
      avgInterventionRate: parseFloat(avgIntervention.toFixed(1)),
      avgTimeToPrMs,
      avgTimeToMergeMs,
      outcomeBreakdown,
      generatedAt: new Date().toISOString(),
    };
  }

  get allRuns(): PilotRunRecord[] {
    return [...this.runs];
  }

  private flush(): void {
    fs.writeFileSync(
      this.filePath,
      JSON.stringify({ runs: this.runs, summary: this.summary }, null, 2),
    );
  }

  /** Generate a human-readable regression + production evaluation report. */
  regressionReport(): string {
    const s = this.summary;
    const lines: string[] = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║   Consensus AI — Regression + Production Evaluation Report   ║',
      '╚══════════════════════════════════════════════════════════════╝',
      '',
      '  ── Pilot metrics ─────────────────────────────────────────────',
      `  Total runs          : ${s.totalRuns}`,
      `  PR opened           : ${s.prOpenedCount} (${s.prOpenedPct.toFixed(0)}%)`,
      `  Avg intervention    : ${s.avgInterventionPct}%`,
      `  Max intervention    : ${s.maxInterventionPct}%`,
      `  Passed ≤20%         : ${s.passedThresholdCount}`,
      `  Failed >20%         : ${s.failedThresholdCount}`,
      `  Invalid audit chains: ${s.auditInvalidCount}`,
      '',
      '  ── Production evaluation ─────────────────────────────────────',
      `  Merge rate          : ${s.mergeRate.toFixed(1)}%`,
      `  Review pass rate    : ${s.reviewPassRate.toFixed(1)}%`,
      `  Revert rate         : ${s.revertRate.toFixed(1)}%`,
      `  Avg time to PR      : ${s.avgTimeToPrMs !== null ? fmtMs(s.avgTimeToPrMs) : 'n/a'}`,
      `  Avg time to merge   : ${s.avgTimeToMergeMs !== null ? fmtMs(s.avgTimeToMergeMs) : 'n/a'}`,
      '',
      '  Outcome breakdown:',
    ];

    for (const [state, count] of Object.entries(s.outcomeBreakdown)) {
      lines.push(`    ${state}: ${count}`);
    }

    lines.push('', '  Failure breakdown:');
    for (const [reason, count] of Object.entries(s.failureBreakdown)) {
      if (count > 0) lines.push(`    ${reason}: ${count}`);
    }

    lines.push('', '  Per-run summary:');
    for (const r of this.runs) {
      const prIcon = r.status === 'pr_opened' || r.status === 'retried_and_passed' ? '✓' : '✗';
      const outcomeTag = r.outcome ? ` [${r.outcome.state}]` : '';
      lines.push(
        `    ${prIcon} [${r.taskId}] ${r.taskLabel.slice(0, 28).padEnd(28)} ` +
        `${String(r.interventionPct).padStart(4)}% ` +
        `${(r.prUrl ? `PR#${r.prNumber}` : r.failureReason ?? 'no PR')}${outcomeTag}`,
      );
    }

    lines.push('');
    const pilotPassing = s.prOpenedPct >= 80 && s.avgInterventionPct <= 20 && s.auditInvalidCount === 0;
    lines.push(pilotPassing
      ? '  ✅  PILOT ACCEPTANCE CRITERIA MET'
      : '  ❌  PILOT ACCEPTANCE CRITERIA NOT MET');
    if (s.prOpenedPct < 80) lines.push(`     • PR opened rate ${s.prOpenedPct.toFixed(0)}% < 80% target`);
    if (s.avgInterventionPct > 20) lines.push(`     • Avg intervention ${s.avgInterventionPct}% > 20% target`);
    if (s.auditInvalidCount > 0) lines.push(`     • ${s.auditInvalidCount} run(s) with invalid audit chains`);

    if (s.totalRuns < 50) {
      lines.push('');
      lines.push(`  ⚠  Only ${s.totalRuns}/50 tasks evaluated — production feature expansion gated until 50 complete.`);
    }

    return lines.join('\n');
  }
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

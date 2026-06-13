import * as fs from 'node:fs';
import type { PilotRunRecord, ScoreboardSummary, FailureReason } from './types.js';

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

  /** Generate a human-readable regression report text. */
  regressionReport(): string {
    const s = this.summary;
    const lines: string[] = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║        Consensus AI — Phase 8 Regression Report              ║',
      '╚══════════════════════════════════════════════════════════════╝',
      '',
      `  Total runs          : ${s.totalRuns}`,
      `  PR opened           : ${s.prOpenedCount} (${s.prOpenedPct.toFixed(0)}%)`,
      `  Avg intervention    : ${s.avgInterventionPct}%`,
      `  Max intervention    : ${s.maxInterventionPct}%`,
      `  Passed ≤20%         : ${s.passedThresholdCount}`,
      `  Failed >20%         : ${s.failedThresholdCount}`,
      `  Invalid audit chains: ${s.auditInvalidCount}`,
      '',
      '  Failure breakdown:',
    ];

    for (const [reason, count] of Object.entries(s.failureBreakdown)) {
      if (count > 0) lines.push(`    ${reason}: ${count}`);
    }

    lines.push('', '  Per-run summary:');
    for (const r of this.runs) {
      const icon = r.status === 'pr_opened' || r.status === 'retried_and_passed' ? '✓' : '✗';
      lines.push(
        `    ${icon} [${r.taskId}] ${r.taskLabel.slice(0, 30).padEnd(30)} ` +
        `${String(r.interventionPct).padStart(4)}% ` +
        `${(r.prUrl ? `PR#${r.prNumber}` : r.failureReason ?? 'no PR')}`,
      );
    }

    lines.push('');
    const passing = s.prOpenedPct >= 80 && s.avgInterventionPct <= 20 && s.auditInvalidCount === 0;
    lines.push(passing
      ? '  ✅  PHASE 8 ACCEPTANCE CRITERIA MET'
      : '  ❌  PHASE 8 ACCEPTANCE CRITERIA NOT MET');
    if (s.prOpenedPct < 80) lines.push(`     • PR opened rate ${s.prOpenedPct.toFixed(0)}% < 80% target`);
    if (s.avgInterventionPct > 20) lines.push(`     • Avg intervention ${s.avgInterventionPct}% > 20% target`);
    if (s.auditInvalidCount > 0) lines.push(`     • ${s.auditInvalidCount} run(s) with invalid audit chains`);

    return lines.join('\n');
  }
}

import type { PRWorkflowReport, OnboardingReport } from '@consensus/shared-types';
import type { InterventionTracker } from './intervention-tracker.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

function bar(pct: number, width = 30): string {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export async function printReport(
  report: PRWorkflowReport,
  tracker: InterventionTracker,
  onboard: OnboardingReport,
  elapsedMs: number,
): Promise<void> {
  const m = tracker.summary;
  const pass = m.underThreshold && report.checklist?.readyToMerge;

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║            Consensus AI — Phase 7 Pilot Report               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // ── Intervention metrics ─────────────────────────────────────────────────
  console.log('\n┌─ Intervention Metrics ─────────────────────────────────────┐');
  console.log(`│  Total agent/tool actions : ${String(m.totalActions).padEnd(34)}│`);
  console.log(`│  Human approvals          : ${String(m.humanInterventions).padEnd(34)}│`);
  console.log(`│  Intervention %           : ${(m.interventionPct + '%').padEnd(34)}│`);
  console.log(`│  Target (≤20%)            : ${(m.underThreshold ? '✓ PASS' : '✗ FAIL').padEnd(34)}│`);
  console.log(`│  Elapsed time             : ${fmt(elapsedMs).padEnd(34)}│`);
  const pctBar = bar(m.interventionPct);
  console.log(`│  ${pctBar} ${m.interventionPct}%      │`);
  console.log('└─────────────────────────────────────────────────────────────┘');

  // ── Repository intelligence ──────────────────────────────────────────────
  console.log('\n┌─ Repository Intelligence ──────────────────────────────────┐');
  console.log(`│  Package manager : ${onboard.packageManager.padEnd(42)}│`);
  console.log(`│  TypeScript      : ${(onboard.hasTypeScript ? 'yes' : 'no').padEnd(42)}│`);
  console.log(`│  Monorepo        : ${(onboard.isMonorepo ? 'yes' : 'no').padEnd(42)}│`);
  console.log(`│  Frameworks      : ${(onboard.frameworks.join(', ') || 'none').slice(0, 42).padEnd(42)}│`);
  console.log(`│  Test command    : ${(onboard.testCommand ?? 'not detected').padEnd(42)}│`);
  console.log(`│  Memories written: ${String(onboard.memoriesWritten).padEnd(42)}│`);
  console.log('└─────────────────────────────────────────────────────────────┘');

  // ── Code review ──────────────────────────────────────────────────────────
  if (report.codeReview) {
    const cr = report.codeReview;
    const verdictIcon = cr.verdict === 'approve' ? '✓' : cr.verdict === 'block' ? '✗' : '⚠';
    console.log('\n┌─ Code Review ───────────────────────────────────────────────┐');
    console.log(`│  Verdict   : ${(`${verdictIcon} ${cr.verdict}`).padEnd(48)}│`);
    console.log(`│  Risk level: ${cr.riskLevel.padEnd(48)}│`);
    if (cr.requiredFixes.length) {
      console.log(`│  Fixes     : ${cr.requiredFixes[0].slice(0, 48).padEnd(48)}│`);
    }
    console.log('└─────────────────────────────────────────────────────────────┘');
  }

  // ── Test results ─────────────────────────────────────────────────────────
  if (report.testResults?.length) {
    console.log('\n┌─ Test Results ──────────────────────────────────────────────┐');
    for (const tr of report.testResults) {
      const icon = tr.status === 'passed' ? '✓' : tr.status === 'tests_not_configured' ? '⚠' : '✗';
      const line = `${icon} ${tr.profile.padEnd(14)} ${tr.status.padEnd(22)} ${fmt(tr.durationMs)}`;
      console.log(`│  ${line.padEnd(61)}│`);
    }
    console.log('└─────────────────────────────────────────────────────────────┘');
  }

  // ── Quality checklist ────────────────────────────────────────────────────
  if (report.checklist) {
    const cl = report.checklist;
    console.log('\n┌─ Quality Checklist ─────────────────────────────────────────┐');
    for (const [label, ok] of [
      ['Security review passed', cl.securityReviewPassed],
      ['Test plan complete', cl.testPlanComplete],
      ['Human approvals obtained', cl.humanApprovalsObtained],
      ['Audit chain valid', cl.auditChainValid],
      ['Required tests passed', cl.requiredTestsPassed ?? true],
    ] as Array<[string, boolean]>) {
      console.log(`│  ${ok ? '✓' : '✗'} ${label.padEnd(58)}│`);
    }
    console.log(`│  ${'─'.repeat(60)}│`);
    const readyIcon = cl.readyToMerge ? '✓' : '✗';
    console.log(`│  ${readyIcon} Ready to merge${' '.repeat(47)}│`);
    if (cl.blockers.length) {
      for (const b of cl.blockers.slice(0, 3)) {
        console.log(`│    BLOCKER: ${b.slice(0, 49).padEnd(49)}│`);
      }
    }
    console.log('└─────────────────────────────────────────────────────────────┘');
  }

  // ── Memory references ────────────────────────────────────────────────────
  if (report.memoryReferences?.length) {
    console.log('\n┌─ Memory References ─────────────────────────────────────────┐');
    for (const ref of report.memoryReferences.slice(0, 5)) {
      const influence = ref.influence.replace(/_/g, ' ');
      console.log(`│  [${influence}] ${ref.title.slice(0, 47).padEnd(47)}│`);
    }
    console.log('└─────────────────────────────────────────────────────────────┘');
  }

  // ── PR link ──────────────────────────────────────────────────────────────
  console.log('\n┌─ Pull Request ──────────────────────────────────────────────┐');
  if (report.prUrl) {
    console.log(`│  ✓ PR #${report.prNumber} opened                                          │`);
    console.log(`│  ${report.prUrl?.slice(0, 61).padEnd(61)}│`);
    console.log(`│  Branch: ${(report.branch ?? '').slice(0, 53).padEnd(53)}│`);
    console.log(`│  Files:  ${(report.filesModified?.join(', ') ?? '').slice(0, 53).padEnd(53)}│`);
  } else {
    console.log('│  ✗ No PR opened                                             │');
    if (report.blockingObjections?.length) {
      console.log(`│    ${report.blockingObjections[0].slice(0, 59).padEnd(59)}│`);
    }
  }
  console.log('└─────────────────────────────────────────────────────────────┘');

  // ── Gate breakdown ───────────────────────────────────────────────────────
  console.log('\n┌─ Human Gates ───────────────────────────────────────────────┐');
  for (const gate of m.approvedGates) {
    console.log(`│  ✓ approved : ${gate.padEnd(46)}│`);
  }
  for (const gate of m.deniedGates) {
    console.log(`│  ✗ denied   : ${gate.padEnd(46)}│`);
  }
  for (const gate of m.unexpectedGates) {
    console.log(`│  ⚠ unexpected: ${gate.padEnd(45)}│`);
  }
  if (!m.approvedGates.length && !m.deniedGates.length) {
    console.log('│  (no manual gates reached)                                  │');
  }
  console.log('└─────────────────────────────────────────────────────────────┘');

  // ── Final verdict ────────────────────────────────────────────────────────
  console.log('');
  if (pass) {
    console.log('  ✅  PILOT PASSED — PR opened, ≤20% human intervention');
  } else {
    console.log('  ❌  PILOT INCOMPLETE');
    if (!m.underThreshold) console.log(`     • intervention ${m.interventionPct}% exceeds 20% threshold`);
    if (!report.checklist?.readyToMerge) console.log('     • checklist not ready to merge');
    if (!report.prUrl) console.log('     • no PR was opened');
  }

  // ── Write JSON report to disk ────────────────────────────────────────────
  const reportPath = path.resolve('./pilot-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    metrics: m,
    onboarding: onboard,
    report,
    elapsedMs,
    passedAcceptanceCriteria: pass,
    generatedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`\n  📄 Full report written to: ${reportPath}\n`);
}

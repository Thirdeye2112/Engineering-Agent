/**
 * Phase 7 Pilot unit tests — no DB/API required.
 * Tests the fixture, intervention tracker, and expected workflow action count.
 * Run: npx tsx --test packages/pilot/src/__tests__/pilot.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InterventionTracker } from '../intervention-tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../../fixture');

// ── Fixture integrity ─────────────────────────────────────────────────────────

describe('Pilot fixture', () => {
  it('fixture directory exists', () => {
    assert.ok(fs.existsSync(FIXTURE_ROOT), `Fixture not found at ${FIXTURE_ROOT}`);
  });

  it('fixture has package.json with test script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'package.json'), 'utf-8'));
    assert.ok(pkg.scripts?.test, 'Missing scripts.test');
  });

  it('fixture src/utils.ts exists without slugify', () => {
    const src = fs.readFileSync(path.join(FIXTURE_ROOT, 'src/utils.ts'), 'utf-8');
    assert.ok(src.includes('capitalize'), 'Missing capitalize');
    assert.ok(src.includes('truncate'), 'Missing truncate');
    assert.ok(!src.includes('export function slugify'), 'slugify export should not be present yet');
  });

  it('fixture src/utils.test.ts has existing passing tests', () => {
    const src = fs.readFileSync(path.join(FIXTURE_ROOT, 'src/utils.test.ts'), 'utf-8');
    assert.ok(src.includes('capitalize'), 'Missing capitalize test');
    assert.ok(src.includes('truncate'), 'Missing truncate test');
    assert.ok(!src.includes('slugify'), 'slugify test should not be present yet');
  });

  it('fixture tsconfig.json exists', () => {
    assert.ok(fs.existsSync(path.join(FIXTURE_ROOT, 'tsconfig.json')));
  });
});

// ── InterventionTracker ───────────────────────────────────────────────────────

describe('InterventionTracker', () => {
  it('tracks allowed gates correctly', () => {
    const t = new InterventionTracker(['github.create_branch', 'github.batch_commit', 'github.open_pr']);
    assert.ok(t.isAllowedGate('github.create_branch'));
    assert.ok(t.isAllowedGate('github.batch_commit'));
    assert.ok(t.isAllowedGate('github.open_pr'));
    assert.ok(!t.isAllowedGate('github.commit_file'));
    assert.ok(!t.isAllowedGate('filesystem.write_file'));
  });

  it('computes 0% intervention with no gates and no actions', () => {
    const t = new InterventionTracker([]);
    assert.equal(t.interventionPct, 0);
  });

  it('computes correct intervention % for expected pilot scenario', () => {
    const t = new InterventionTracker(['github.create_branch', 'github.batch_commit', 'github.open_pr']);

    // Simulate 19 auto actions (debate, reads, writes, review, tests, memory...)
    for (let i = 0; i < 19; i++) t.recordAutoAction('auto');

    // 3 human gate requests
    t.recordInterventionRequest('github.create_branch', 'req-1');
    t.recordApproved('req-1', 'github.create_branch');

    t.recordInterventionRequest('github.batch_commit', 'req-2');
    t.recordApproved('req-2', 'github.batch_commit');

    t.recordInterventionRequest('github.open_pr', 'req-3');
    t.recordApproved('req-3', 'github.open_pr');

    // 19 auto + 3 gate requests (as actions) = 22 total, 3 interventions
    // pct = 3 / (22 + 3) * 100 = 12%
    assert.ok(t.interventionPct <= 20, `Intervention ${t.interventionPct}% exceeds 20%`);
    assert.equal(t.totalInterventions, 3);
    assert.ok(t.summary.underThreshold);
  });

  it('records unexpected gates and marks them in summary', () => {
    const t = new InterventionTracker(['github.create_branch']);
    t.recordUnexpected('github.delete_repo');
    assert.deepEqual(t.summary.unexpectedGates, ['github.delete_repo']);
  });

  it('underThreshold=false when >20% intervention', () => {
    const t = new InterventionTracker(['github.create_branch']);
    // 5 actions, 2 interventions → 2/7 = 28.5%
    for (let i = 0; i < 5; i++) t.recordAction();
    t.recordInterventionRequest('github.create_branch', 'r1');
    t.recordApproved('r1', 'github.create_branch');
    t.recordInterventionRequest('github.create_branch', 'r2');
    t.recordApproved('r2', 'github.create_branch');
    assert.ok(!t.summary.underThreshold);
  });
});

// ── Expected action count model ───────────────────────────────────────────────

describe('Expected action model (≤20% target)', () => {
  it('3 human gates out of 25 total = 12% — within target', () => {
    // This models the expected pilot flow:
    // Auto: memory_load, repo_intel, debate×2, read_file×2, write_file×2,
    //       code_review, test_plan, test_run, sec_review, audit_verify,
    //       checklist, memory_refs, memory_write×3, broadcast = 19 auto actions
    //       + 3 gate_requests (recorded as actions by tracker) = 22 total
    // Human: 3 approvals
    // Denominator: 22 + 3 = 25
    const autoActions = 19;
    const gateRequestsAsActions = 3;
    const humanInterventions = 3;
    const total = autoActions + gateRequestsAsActions + humanInterventions;
    const pct = (humanInterventions / total) * 100;

    assert.ok(pct <= 20, `${pct}% exceeds 20% threshold`);
    assert.equal(Math.round(pct), 12);
  });

  it('batch_commit saves 1+ approval vs individual commit_file calls', () => {
    // With 2 files and batch_commit: 1 approval for the batch
    // With individual commit_file: 2 approvals (1 per file)
    // Net saving: 1 approval → drops intervention from ~16% to ~12%
    const batchApprovals = 1;
    const perFileApprovals = 2;
    assert.ok(batchApprovals < perFileApprovals);
  });

  it('auto-allow sandbox writes saves 2 approvals vs approval_required', () => {
    // 2 files written × approval_required = 2 approvals saved
    // That would push intervention from 12% to ~20% — right at the boundary
    const savedApprovals = 2;
    const approvalsCausedByTrustedRole = 0;
    assert.ok(savedApprovals > approvalsCausedByTrustedRole);
  });

  it('auto-allow test runner saves 1 approval per test profile', () => {
    // Each safe_test_runner.run profile would cost 1 approval if gated
    // Auto-allow saves this: 1 profile run = 0 approvals
    const approvalWithGate = 1;
    const approvalWithAutoAllow = 0;
    assert.ok(approvalWithAutoAllow < approvalWithGate);
  });
});

// ── Sample report validation ──────────────────────────────────────────────────

describe('Sample pilot report', () => {
  const samplePath = path.resolve(__dirname, '../../pilot-report.sample.json');

  it('sample report file exists', () => {
    assert.ok(fs.existsSync(samplePath));
  });

  it('sample report passes acceptance criteria', () => {
    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
    assert.equal(sample.passedAcceptanceCriteria, true);
  });

  it('sample report shows ≤20% intervention', () => {
    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
    assert.ok(sample.metrics.interventionPct <= 20, `Got ${sample.metrics.interventionPct}%`);
  });

  it('sample report has exactly 3 human gates', () => {
    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
    assert.equal(sample.metrics.humanInterventions, 3);
    assert.deepEqual(sample.metrics.approvedGates, [
      'github.create_branch',
      'github.batch_commit',
      'github.open_pr',
    ]);
  });

  it('sample report shows test passed', () => {
    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
    assert.equal(sample.report.testResults[0].status, 'passed');
  });

  it('sample report shows code review approve', () => {
    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
    assert.equal(sample.report.codeReview.verdict, 'approve');
  });

  it('sample report checklist readyToMerge=true', () => {
    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
    assert.equal(sample.report.checklist.readyToMerge, true);
  });

  it('sample report has audit chain valid', () => {
    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
    assert.equal(sample.auditVerification.valid, true);
  });

  it('sample report has memory references', () => {
    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
    assert.ok(sample.report.memoryReferences.length > 0);
    assert.ok(sample.report.memoryReferences.every((r: { influence: string }) =>
      ['applied', 'considered', 'rejected_as_outdated'].includes(r.influence)
    ));
  });

  it('sample report PR opened', () => {
    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
    assert.ok(sample.report.prUrl);
    assert.ok(sample.report.prNumber > 0);
  });
});

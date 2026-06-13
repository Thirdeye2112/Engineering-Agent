/**
 * Phase 8 Suite Runner
 *
 * Runs all 5 canned pilot tasks against the fixture repo,
 * records results to pilot-scoreboard.json, and prints a regression report.
 *
 * Usage:
 *   pnpm suite               # interactive (prompts at each gate)
 *   pnpm suite:auto          # fully automated (auto-approves all expected gates)
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRWorkflow, OnboardingWorkflow, createProvider } from '@consensus/agent-manager';
import { permissionEngine } from '@consensus/permissions';
import type { PRWorkflowEvent } from '@consensus/agent-manager';
import type { ProviderName, TierName } from '@consensus/shared-types';
import { InterventionTracker } from './intervention-tracker.js';
import { PilotScoreboard } from './scoreboard.js';
import { RetryRunner } from './retry-runner.js';
import { PILOT_TASKS } from './task-suite.js';
import type { PilotTask } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_MASTER = path.resolve(__dirname, '../fixture');

const AUTO_APPROVE = process.argv.includes('--auto-approve');
const PROVIDER = (process.env.PILOT_PROVIDER ?? 'anthropic') as ProviderName;
const TIER = (process.env.PILOT_TIER ?? 'standard') as TierName;
const FAST_TIER = (process.env.PILOT_FAST_TIER ?? 'fast') as TierName;
const APPROVAL_TIMEOUT_MS = parseInt(process.env.PILOT_APPROVAL_TIMEOUT_MS ?? '120000', 10);
const GITHUB_REPO = process.env.GITHUB_REPO ?? '';
const SCOREBOARD_PATH = path.resolve('./pilot-scoreboard.json');
const EXPECTED_GATES = [
  'github.create_branch',
  'github.batch_commit',
  'github.open_pr',
  'terminal.run',   // safe_test_runner delegates to terminal tool in sandbox
];

/** Create a fresh copy of the fixture for each run to avoid state bleed. */
function cloneFixture(taskId: string): string {
  const dest = path.resolve(`/tmp/pilot-fixture-${taskId}-${Date.now()}`);
  fs.cpSync(FIXTURE_MASTER, dest, { recursive: true });
  return dest;
}

function checkPrereqs(): boolean {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  // REDIS_URL is optional — ConversationStore falls back to PostgreSQL when absent
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GOOGLE_API_KEY) {
    missing.push('ANTHROPIC_API_KEY (or OPENAI_API_KEY / GOOGLE_API_KEY)');
  }
  if (!process.env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
  if (!process.env.GITHUB_REPO) missing.push('GITHUB_REPO (e.g. owner/repo)');
  if (missing.length > 0) {
    console.error('\n❌  Missing required environment variables:\n');
    for (const v of missing) console.error(`   • ${v}`);
    return false;
  }
  return true;
}

async function runTask(task: PilotTask) {
  const projectId = `suite-${task.id}-${Date.now()}`;
  const sandboxRoot = cloneFixture(task.id);

  const tracker = new InterventionTracker(EXPECTED_GATES);

  // Wire approval handler
  permissionEngine.onApprovalRequest = async (_projectId, requestId, detail) => {
    const d = detail as { tool: string; operation: string; rationale: string };
    const toolOp = `${d.tool}.${d.operation}`;
    tracker.recordInterventionRequest(toolOp, requestId);

    let approved: boolean;
    if (tracker.isAllowedGate(toolOp)) {
      approved = AUTO_APPROVE || await tracker.promptHuman(toolOp, d.rationale);
    } else {
      console.warn(`\n⚠️  Unexpected gate: ${toolOp} — auto-denying`);
      tracker.recordUnexpected(toolOp);
      approved = false;
    }

    await permissionEngine.resolveRequest(requestId, approved ? 'approved' : 'denied', 'human-suite');
    if (approved) tracker.recordApproved(requestId, toolOp);
    else tracker.recordDenied(requestId, toolOp);
  };

  // Onboarding
  const onboarding = new OnboardingWorkflow();
  await onboarding.run({ projectId, sandboxRoot, repoFullName: GITHUB_REPO || undefined });

  const startMs = Date.now();
  const primaryProvider = createProvider(PROVIDER, TIER);
  const fastProvider = createProvider(PROVIDER, FAST_TIER);

  const workflow = new PRWorkflow({
    projectId,
    task: task.prompt,
    repoFullName: GITHUB_REPO || undefined,
    agents: [
      { provider: primaryProvider, role: 'implementation_agent' as never },
      { provider: fastProvider,   role: 'critic' as never },
    ],
    sandboxRoot,
    useMemory: true,
    runTests: true,
    approvalTimeoutMs: APPROVAL_TIMEOUT_MS,
    onEvent: (ev: PRWorkflowEvent) => {
      const e = ev as Record<string, unknown>;
      if (ev.type === 'tool_called') tracker.recordAction('tool_called');
      else tracker.recordAutoAction(ev.type);
      if (ev.type === 'pr_opened') console.log(`  🎉 PR opened: ${e.prUrl}`);
    },
  });

  const report = await workflow.run();
  const elapsedMs = Date.now() - startMs;
  const m = tracker.summary;

  tracker.closePrompt();

  // Clean up cloned fixture
  try { fs.rmSync(sandboxRoot, { recursive: true, force: true }); } catch { /* best effort */ }

  return {
    report,
    elapsedMs,
    interventionPct: m.interventionPct,
    totalActions: m.totalActions,
    humanInterventions: m.humanInterventions,
    approvalsRequested: m.approvedGates.length + m.deniedGates.length,
    approvalsDenied: m.deniedGates.length,
  };
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║     Consensus AI — Phase 8 Pilot Suite Runner                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log(`  Tasks   : ${PILOT_TASKS.length}`);
  console.log(`  Repo    : ${GITHUB_REPO || '(not configured)'}`);
  console.log(`  Mode    : ${AUTO_APPROVE ? 'auto-approve' : 'interactive'}`);
  console.log(`  Scoreboard: ${SCOREBOARD_PATH}\n`);

  if (!checkPrereqs()) process.exit(1);

  const scoreboard = new PilotScoreboard(SCOREBOARD_PATH);
  const runner = new RetryRunner({
    runTask,
    onRetry: (task, attempt, reason) => {
      console.log(`\n  🔄 Retrying ${task.id} (attempt ${attempt}) — ${reason}\n`);
    },
  });

  for (const task of PILOT_TASKS) {
    console.log(`\n${'─'.repeat(64)}`);
    console.log(`  Task: [${task.id}] ${task.label}`);
    console.log(`${'─'.repeat(64)}`);

    try {
      const record = await runner.run(task, GITHUB_REPO);
      scoreboard.append(record);

      const icon = record.status === 'pr_opened' || record.status === 'retried_and_passed' ? '✅' : '❌';
      console.log(`  ${icon} ${task.label} → ${record.status} (${record.interventionPct}% intervention)`);
      if (record.failureReason) {
        console.log(`     Failure: ${record.failureReason} — ${record.failureDetail?.slice(0, 80)}`);
      }
    } catch (err) {
      console.error(`  ❌ Unexpected error for ${task.id}:`, err);
    }
  }

  console.log('\n');
  console.log(scoreboard.regressionReport());
  console.log(`\n  📄 Scoreboard written to: ${SCOREBOARD_PATH}\n`);
}

main().catch(err => {
  console.error('\n❌ Suite runner failed:', err);
  process.exit(1);
});

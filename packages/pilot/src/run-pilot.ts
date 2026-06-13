/**
 * Phase 7 Pilot Runner
 *
 * Demonstrates end-to-end PR automation with <20% human intervention.
 * Task: Add slugify() to the fixture TypeScript utility library.
 *
 * Usage:
 *   pnpm pilot                  # interactive mode (prompts for each gate)
 *   pnpm pilot:auto             # fully automated (no prompts, auto-approves gates)
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY           # or OPENAI_API_KEY / GOOGLE_API_KEY
 *   GITHUB_TOKEN                # for creating branch + PR
 *   GITHUB_REPO                 # target repo e.g. "owner/repo"
 *   DATABASE_URL                # PostgreSQL connection string
 *   REDIS_URL                   # Redis connection string
 *
 * Optional:
 *   PILOT_PROVIDER              # anthropic | openai | google (default: anthropic)
 *   PILOT_TIER                  # fast | standard | premium (default: standard)
 *   PILOT_APPROVAL_TIMEOUT_MS   # ms to wait for approval (default: 120000)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRWorkflow } from '@consensus/agent-manager';
import { OnboardingWorkflow } from '@consensus/agent-manager';
import { createProvider } from '@consensus/agent-manager';
import { permissionEngine } from '@consensus/permissions';
import type { PRWorkflowEvent } from '@consensus/agent-manager';
import type { ProviderName, TierName } from '@consensus/shared-types';
import { InterventionTracker } from './intervention-tracker.js';
import { printReport } from './report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '../../fixture');

// ── Configuration ─────────────────────────────────────────────────────────────

const AUTO_APPROVE = process.argv.includes('--auto-approve');
const PROJECT_ID = `pilot-${Date.now()}`;
const PROVIDER = (process.env.PILOT_PROVIDER ?? 'anthropic') as ProviderName;
const TIER = (process.env.PILOT_TIER ?? 'standard') as TierName;
const FAST_TIER = (process.env.PILOT_FAST_TIER ?? 'fast') as TierName;
const APPROVAL_TIMEOUT_MS = parseInt(process.env.PILOT_APPROVAL_TIMEOUT_MS ?? '120000', 10);

const GITHUB_REPO = process.env.GITHUB_REPO ?? '';
const [GH_OWNER, GH_REPO] = GITHUB_REPO.split('/');

const PILOT_TASK = [
  'Add a slugify(text: string): string utility function to src/utils.ts.',
  'The function should:',
  '  1. Trim whitespace',
  '  2. Lowercase the entire string',
  '  3. Replace spaces and underscores with hyphens',
  '  4. Remove all characters that are not alphanumeric or hyphens',
  '  5. Collapse consecutive hyphens into one',
  '  6. Remove leading and trailing hyphens',
  'Also add tests for slugify() in src/utils.test.ts covering:',
  '  - basic phrase → "hello-world"',
  '  - leading/trailing whitespace stripped',
  '  - special characters removed',
  '  - multiple spaces → single hyphen',
  '  - already-slugified input unchanged',
  'Do not modify any existing functions or tests.',
  'Use the batch_commit operation to commit all changed files in one call.',
  `Commit to branch feature/add-slugify in repo ${GH_OWNER}/${GH_REPO}.`,
  'After committing, open a PR with title "feat: add slugify utility".',
].join('\n');

// ── Prerequisites check ───────────────────────────────────────────────────────

function checkPrereqs(): boolean {
  const missing: string[] = [];

  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.REDIS_URL && !process.env.UPSTASH_REDIS_REST_URL) missing.push('REDIS_URL');
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GOOGLE_API_KEY) {
    missing.push('ANTHROPIC_API_KEY (or OPENAI_API_KEY / GOOGLE_API_KEY)');
  }
  if (!process.env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
  if (!process.env.GITHUB_REPO) missing.push('GITHUB_REPO (e.g. owner/repo)');

  if (missing.length > 0) {
    console.error('\n❌  Missing required environment variables:\n');
    for (const v of missing) console.error(`   • ${v}`);
    console.error('\nSet them in your shell or a .env file and retry.\n');
    return false;
  }
  return true;
}

// ── Event logger ──────────────────────────────────────────────────────────────

function makeEventLogger(tracker: InterventionTracker) {
  const ICONS: Record<string, string> = {
    debate_started:           '🗣️  debate_started',
    debate_complete:          '✅  debate_complete',
    implementation_started:   '⚙️  implementation_started',
    tool_called:              '    🔧',
    tool_result:              '      →',
    code_review_started:      '🔍  code_review_started',
    code_review_complete:     '📋  code_review_complete',
    test_plan_complete:       '📝  test_plan_complete',
    tests_started:            '🧪  tests_started',
    test_complete:            '    →',
    security_review_started:  '🔒  security_review_started',
    security_review_complete: '🔒  security_review_complete',
    memory_loaded:            '🧠  memory_loaded',
    memory_written:           '💾  memory_written',
    pr_opened:                '🎉  PR OPENED',
    workflow_complete:        '✨  workflow_complete',
    workflow_error:           '❌  workflow_error',
  };

  return (ev: PRWorkflowEvent) => {
    const label = ICONS[ev.type] ?? `    ${ev.type}`;
    const e = ev as Record<string, unknown>;

    if (ev.type === 'tool_called') {
      console.log(`${label} ${e.tool}.${e.operation}`);
      tracker.recordAction('tool_called');
    } else if (ev.type === 'tool_result') {
      console.log(`${label} ${e.success ? 'ok' : '✗ FAILED'}`);
    } else if (ev.type === 'debate_complete') {
      const plan = String(e.plan ?? '').slice(0, 100);
      console.log(`${label}: ${plan}…`);
      tracker.recordAutoAction('debate_complete');
    } else if (ev.type === 'code_review_complete') {
      console.log(`${label}: verdict=${e.verdict} risk=${e.riskLevel}`);
      tracker.recordAutoAction('code_review');
    } else if (ev.type === 'test_complete') {
      console.log(`${label} ${e.profile} → ${e.status}`);
      tracker.recordAutoAction('test_run');
    } else if (ev.type === 'pr_opened') {
      console.log(`\n${label}: ${e.prUrl}`);
    } else if (ev.type === 'memory_loaded') {
      console.log(`${label}: ${e.count} memories`);
      tracker.recordAutoAction('memory_load');
    } else if (ev.type === 'memory_written') {
      console.log(`${label}: ${e.count} memories`);
      tracker.recordAutoAction('memory_write');
    } else if (ev.type === 'test_plan_complete') {
      console.log(`${label}: ${e.requiredCount} required tests`);
      tracker.recordAutoAction('test_plan');
    } else {
      console.log(label);
      tracker.recordAutoAction(ev.type);
    }
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║       Consensus AI — Phase 7 Pilot Run                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log(`  Task    : Add slugify() utility`);
  console.log(`  Repo    : ${GITHUB_REPO || '(not configured)'}`);
  console.log(`  Provider: ${PROVIDER}/${TIER}`);
  console.log(`  Mode    : ${AUTO_APPROVE ? 'auto-approve' : 'interactive'}`);
  console.log(`  Project : ${PROJECT_ID}\n`);

  if (!checkPrereqs()) process.exit(1);

  // ── Intervention tracker ─────────────────────────────────────────────────
  const tracker = new InterventionTracker([
    'github.create_branch',
    'github.batch_commit',
    'github.open_pr',
  ]);

  // ── Wire up approval handler ─────────────────────────────────────────────
  // This is the ONLY place humans interact — 3 expected gates.
  permissionEngine.onApprovalRequest = async (projectId, requestId, detail) => {
    const d = detail as { agentRole: string; tool: string; operation: string; rationale: string };
    const toolOp = `${d.tool}.${d.operation}`;
    tracker.recordInterventionRequest(toolOp, requestId);

    let approved: boolean;
    if (tracker.isAllowedGate(toolOp)) {
      approved = AUTO_APPROVE || await tracker.promptHuman(toolOp, d.rationale);
    } else {
      // Unexpected gate — auto-deny, surface as warning
      console.warn(`\n⚠️  Unexpected gate reached: ${toolOp} — auto-denying`);
      approved = false;
      tracker.recordUnexpected(toolOp);
    }

    await permissionEngine.resolveRequest(requestId, approved ? 'approved' : 'denied', 'human-pilot');
    if (approved) tracker.recordApproved(requestId, toolOp);
    else tracker.recordDenied(requestId, toolOp);
  };

  // ── Step 1: Repository onboarding ───────────────────────────────────────
  console.log('📋  Step 1: Repository onboarding\n');
  const onboarding = new OnboardingWorkflow();
  const onboardReport = await onboarding.run({
    projectId: PROJECT_ID,
    repoFullName: GITHUB_REPO || undefined,
    sandboxRoot: FIXTURE_ROOT,
  });
  console.log(`    Package manager : ${onboardReport.packageManager}`);
  console.log(`    TypeScript      : ${onboardReport.hasTypeScript ? 'yes' : 'no'}`);
  console.log(`    Frameworks      : ${onboardReport.frameworks.join(', ') || 'none'}`);
  console.log(`    Test command    : ${onboardReport.testCommand ?? 'none'}`);
  console.log(`    Memories written: ${onboardReport.memoriesWritten}`);
  console.log(`    Rules created   : ${onboardReport.permissionRulesCreated}\n`);

  // ── Step 2: PR Workflow ──────────────────────────────────────────────────
  console.log('🚀  Step 2: PR Workflow\n');
  const startMs = Date.now();

  const primaryProvider = createProvider(PROVIDER, TIER);
  const fastProvider = createProvider(PROVIDER, FAST_TIER);

  const workflow = new PRWorkflow({
    projectId: PROJECT_ID,
    task: PILOT_TASK,
    repoFullName: GITHUB_REPO || undefined,
    agents: [
      { provider: primaryProvider, role: 'implementation_agent' as never },
      { provider: fastProvider,   role: 'critic' as never },
    ],
    sandboxRoot: FIXTURE_ROOT,
    useMemory: true,
    runTests: true,
    approvalTimeoutMs: APPROVAL_TIMEOUT_MS,
    onEvent: makeEventLogger(tracker),
  });

  const report = await workflow.run();
  const elapsedMs = Date.now() - startMs;

  tracker.closePrompt();

  // ── Final report ─────────────────────────────────────────────────────────
  await printReport(report, tracker, onboardReport, elapsedMs);
}

main().catch(err => {
  console.error('\n❌  Pilot failed:', err);
  process.exit(1);
});

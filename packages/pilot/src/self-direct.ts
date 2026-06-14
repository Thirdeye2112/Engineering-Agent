#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve } from 'node:path';
// Load .env from the repo root (works whether run from root or packages/pilot)
config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '../../.env') });

/**
 * Self-directing agent loop CLI
 *
 * Agents read the repo, propose the next most valuable task, debate and
 * vote on it, then implement it autonomously as a PR. Repeats until the
 * target count is reached or the process is interrupted.
 *
 * Usage:
 *   pnpm self-direct                    # run forever (Ctrl+C to stop)
 *   pnpm self-direct --tasks 5          # stop after 5 completed PRs
 *   pnpm self-direct --tasks 1 --dry    # plan only, don't implement
 */

import { AutoLoop } from '@consensus/agent-manager';
import type { AutoLoopEvent } from '@consensus/agent-manager';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const tasksArg = args.indexOf('--tasks');
const maxTasks = tasksArg !== -1 ? parseInt(args[tasksArg + 1] ?? '5', 10) : null;
const spendArg = args.indexOf('--max-spend');
const maxSpendUsd = spendArg !== -1 ? parseFloat(args[spendArg + 1] ?? '5') : undefined;
const dryRun = args.includes('--dry');
const GITHUB_REPO = process.env.GITHUB_REPO ?? '';
// Sandbox is the fixture mini-repo for safe file operations.
// REPO_ROOT is passed to the planner so it describes the real codebase.
const SANDBOX_ROOT = path.resolve(__dirname, '../fixture');
const REPO_ROOT = process.env.REPO_ROOT ?? path.resolve(__dirname, '../../../');

function checkPrereqs(): boolean {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  const hasKey = process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    process.env.GOOGLE_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!hasKey) missing.push('ANTHROPIC_API_KEY (or OpenAI/Google equivalent)');
  if (!process.env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
  if (!GITHUB_REPO) missing.push('GITHUB_REPO (e.g. owner/repo)');
  if (missing.length > 0) {
    console.error('\n❌  Missing required environment variables:\n');
    for (const v of missing) console.error(`   • ${v}`);
    return false;
  }
  return true;
}

function formatEvent(ev: AutoLoopEvent): string {
  switch (ev.type) {
    case 'loop_started':
      return `🚀 Loop started${ev.maxTasks ? ` — target: ${ev.maxTasks} PRs` : ' — running until stopped'}`;
    case 'planning':
      return `\n${'─'.repeat(56)}\n  🧠 Iteration ${ev.iteration}: Planning next task...`;
    case 'tasks_proposed':
      return [
        `  📋 ${ev.repoSummary}`,
        `  Proposed tasks:`,
        ...ev.tasks.map((t, i) => `    ${i + 1}. [${t.priority}] ${t.title}`),
      ].join('\n');
    case 'task_selected':
      return `  ✅ Selected: ${ev.task.title}`;
    case 'task_started':
      return `  ⚙️  Implementing: ${ev.task.description}`;
    case 'task_complete':
      return `  🎉 PR opened: ${ev.prUrl}`;
    case 'task_failed':
      return `  ❌ Failed: ${ev.reason}`;
    case 'loop_stopped':
      return `\n${'═'.repeat(56)}\n  Loop stopped (${ev.reason}) — ${ev.completed} PRs opened`;
    default:
      return '';
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║     Consensus AI — Self-Directing Agent Loop           ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  console.log(`  Repo    : ${GITHUB_REPO || '(not configured)'}`);
  console.log(`  Target  : ${maxTasks ? `${maxTasks} PRs` : 'unlimited'}`);
  console.log(`  Spend   : ${maxSpendUsd !== undefined ? `$${maxSpendUsd} cap` : 'no cap'}`);
  console.log(`  Mode    : ${dryRun ? 'dry-run (plan only)' : 'autonomous'}\n`);

  if (!checkPrereqs()) process.exit(1);

  if (dryRun) {
    console.log('  Dry-run mode: planning only, no implementation.\n');
  }

  const loop = new AutoLoop({
    maxTasks: maxTasks ?? undefined,
    maxSpendUsd,
    repoFullName: GITHUB_REPO,
    sandboxRoot: SANDBOX_ROOT,
    repoRoot: REPO_ROOT,
    onEvent: (ev) => {
      const line = formatEvent(ev);
      if (line) console.log(line);
    },
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log('\n\n  ⚠️  Interrupt received — finishing current task then stopping...');
    loop.stop('SIGINT');
  });

  const result = await loop.run();

  console.log('\n  Summary:');
  console.log(`    PRs opened : ${result.completed}`);
  console.log(`    Failed     : ${result.failed}`);
  console.log(`    Spend      : $${result.totalSpendUsd.toFixed(4)}`);
  if (result.prUrls.length > 0) {
    console.log('    PR URLs:');
    for (const url of result.prUrls) console.log(`      • ${url}`);
  }
  console.log();
}

main().catch(err => {
  console.error('\n❌ Self-direct loop failed:', err);
  process.exit(1);
});

/**
 * Milestone 1: Production Evaluation — Outcome Sync CLI
 *
 * Reads pilot-scoreboard.json, polls GitHub for current PR states,
 * writes outcomes back, and prints an updated production report.
 *
 * Usage:
 *   pnpm sync-outcomes                   # sync all pending PRs
 *   pnpm sync-outcomes --report          # sync + print full report
 *
 * Required env vars:
 *   GITHUB_TOKEN      GitHub personal access token (read:org + repo scopes)
 *
 * Optional:
 *   SCOREBOARD_PATH   path to pilot-scoreboard.json (default: ./pilot-scoreboard.json)
 */

import path from 'node:path';
import { PilotScoreboard } from './scoreboard.js';
import { OutcomeSyncer } from './outcome-syncer.js';

const SCOREBOARD_PATH = process.env.SCOREBOARD_PATH ?? path.resolve('./pilot-scoreboard.json');
const PRINT_REPORT = process.argv.includes('--report');

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   Consensus AI — Milestone 1: PR Outcome Sync                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  if (!process.env.GITHUB_TOKEN) {
    console.error('❌  GITHUB_TOKEN is not set. Aborting.\n');
    process.exit(1);
  }

  const scoreboard = new PilotScoreboard(SCOREBOARD_PATH);
  const pending = scoreboard.pendingSyncRuns();

  if (pending.length === 0) {
    console.log('  ℹ  No pending PRs to sync.\n');
  } else {
    console.log(`  Syncing ${pending.length} PR(s)...\n`);
    const syncer = new OutcomeSyncer(scoreboard);
    const results = await syncer.syncAll();

    for (const r of results) {
      const arrow = r.previous && r.previous !== r.current ? ` (${r.previous} → ${r.current})` : '';
      const icon = r.updated ? '✓' : '✗';
      console.log(`  ${icon} ${r.repo}#${r.prNumber}: ${r.current}${arrow}`);
    }
  }

  const s = scoreboard.summary;
  console.log('\n  ── Production metrics ─────────────────────────────────────────');
  console.log(`  PR open rate     : ${s.prOpenedPct.toFixed(1)}%  (${s.prOpenedCount}/${s.totalRuns})`);
  console.log(`  Merge rate       : ${s.mergeRate.toFixed(1)}%`);
  console.log(`  Review pass rate : ${s.reviewPassRate.toFixed(1)}%`);
  console.log(`  Revert rate      : ${s.revertRate.toFixed(1)}%`);
  console.log(`  Avg intervention : ${s.avgInterventionRate.toFixed(1)}%`);
  console.log(`  Avg time to PR   : ${s.avgTimeToPrMs !== null ? fmtMs(s.avgTimeToPrMs) : 'n/a'}`);
  console.log(`  Avg time to merge: ${s.avgTimeToMergeMs !== null ? fmtMs(s.avgTimeToMergeMs) : 'n/a'}`);
  console.log('');
  console.log('  Outcome breakdown:');
  for (const [state, count] of Object.entries(s.outcomeBreakdown)) {
    if (count > 0) console.log(`    ${state}: ${count}`);
  }

  if (PRINT_REPORT) {
    console.log('\n');
    console.log(scoreboard.regressionReport());
  }

  console.log(`\n  📄 Scoreboard: ${SCOREBOARD_PATH}\n`);
}

main().catch(err => {
  console.error('\n❌  sync-outcomes failed:', err);
  process.exit(1);
});

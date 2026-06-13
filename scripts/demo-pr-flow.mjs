/**
 * End-to-end demo: agents plan a small change, system reads + proposes a patch,
 * human approves, system commits to feature branch, opens a PR.
 *
 * Usage:
 *   node --env-file=.env scripts/demo-pr-flow.mjs [owner/repo]
 *
 * Defaults to: thirdeye2112/engineering-agent
 */

import { WebSocket } from 'ws';
import readline from 'node:readline';

const BASE = 'http://localhost:3000';
const [, , TARGET_REPO = 'thirdeye2112/engineering-agent'] = process.argv;
const [OWNER, REPO] = TARGET_REPO.split('/');

const TASK = `
Read the file README.md (or docs/DEMO.md if it exists) from the GitHub repo ${OWNER}/${REPO},
then propose a small, safe improvement: add a "## Recent Changes" section at the bottom
listing the three most recent Phase improvements (Phase A–F trust layer work, Phase 2 GitHub integration).
Do not change any existing content. Only append the new section.
After proposing the write, wait for human approval before committing.
Create a feature branch named "demo/add-recent-changes", commit the change to that branch,
then open a pull request titled "docs: add Recent Changes section" targeting main.
`.trim();

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

async function approveRequest(requestId) {
  const resp = await fetch(`${BASE}/permission-requests/${requestId}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reviewedBy: 'demo-human' }),
  });
  if (!resp.ok) throw new Error(`Approve failed: ${resp.status}`);
  return resp.json();
}

async function waitForEvent(ws, type, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    const handler = (data) => {
      const e = JSON.parse(data.toString());
      if (e.type === type || e.type === 'workflow_complete' || e.type === 'workflow_error') {
        clearTimeout(t);
        ws.off('message', handler);
        resolve(e);
      }
      // Auto-approve permission requests during demo
      if (e.type === 'permission_requested') {
        console.log(`\n  [Permission requested] ${e.detail?.tool}.${e.detail?.operation} — requestId: ${e.requestId}`);
        prompt(`  Approve? (y/n) > `).then(ans => {
          if (ans.toLowerCase() === 'y' || ans === '') {
            return approveRequest(e.requestId).then(() => console.log('  ✓ Approved'));
          } else {
            console.log('  ✗ Denied (demo aborted)');
            clearTimeout(t);
            ws.off('message', handler);
            reject(new Error('User denied permission request'));
          }
        });
      }
    };
    ws.on('message', handler);
  });
}

async function main() {
  // Health check
  const health = await fetch(`${BASE}/health`).then(r => r.json());
  if (health.status !== 'ok') throw new Error('Server not running');
  console.log('✓ Server healthy\n');

  console.log(`Demo target: ${OWNER}/${REPO}`);
  console.log(`Task: ${TASK.slice(0, 120)}...\n`);

  // Create PR workflow project
  const { projectId } = await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      task: TASK,
      mode: 'pr_workflow',
      agents: [
        { provider: 'anthropic', tier: 'fast', role: 'architect' },
        { provider: 'anthropic', tier: 'fast', role: 'security_reviewer' },
      ],
      maxRounds: 1,
      budgetCap: 0.50,
    }),
  }).then(r => r.json());

  console.log(`Project created: ${projectId}`);
  console.log('Connecting to event stream...\n');

  const ws = new WebSocket(`ws://localhost:3000?projectId=${projectId}`);
  const events = [];

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.close(); resolve(); }, 180_000);

    ws.on('message', async (data) => {
      const e = JSON.parse(data.toString());
      events.push(e);

      if (e.type === 'debate_started') console.log('  [debate] Agents planning the change...');
      if (e.type === 'debate_complete') console.log('  [debate] Plan agreed ✓');
      if (e.type === 'implementation_started') console.log(`  [implement] ${e.role} starting implementation...`);
      if (e.type === 'tool_called') console.log(`  [tool] ${e.tool}.${e.operation}`);
      if (e.type === 'tool_result') process.stdout.write(e.success ? '.' : 'x');
      if (e.type === 'pr_opened') console.log(`\n  [PR] #${e.prNumber} opened: ${e.url}`);
      if (e.type === 'security_review_complete') {
        console.log(`  [security] ${e.approved ? '✓ Approved' : '⚠ Issues found'}`);
      }
      if (e.type === 'workflow_complete') {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
      if (e.type === 'workflow_error') {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
      if (e.type === 'permission_requested') {
        console.log(`\n  ▶ Permission request: ${e.detail?.tool}.${e.detail?.operation}`);
        const ans = await prompt('  Approve this action? [Y/n] ');
        if (ans.toLowerCase() !== 'n') {
          await approveRequest(e.requestId);
          console.log('  ✓ Approved — agent will retry\n');
        } else {
          console.log('  ✗ Denied');
        }
      }
    });

    ws.on('error', reject);
  });

  // Final report
  const project = await fetch(`${BASE}/projects/${projectId}`).then(r => r.json());
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`DEMO RESULT: ${project.status.toUpperCase()}`);
  if (project.report?.prUrl) {
    console.log(`PR: ${project.report.prUrl}`);
  }
  if (project.report?.steps?.length) {
    console.log(`Steps: ${project.report.steps.length}`);
  }
  if (project.report?.totalCostUsd !== undefined) {
    console.log(`Cost: $${project.report.totalCostUsd.toFixed(4)}`);
  }

  // Verify audit chain
  const audit = await fetch(`${BASE}/audit/verify`).then(r => r.json());
  console.log(`Audit chain: ${audit.valid ? '✓ valid' : '✗ INVALID'} (${audit.checkedCount} events)`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });

import { WebSocket } from 'ws';

const BASE = 'http://localhost:3000';

const TASK = `
We are building a multi-agent AI collaboration platform called Consensus AI. 
The core idea: multiple AI agents (from any provider — Anthropic, OpenAI, Google) can debate topics, 
collaborate on subtasks, or autonomously implement code changes via a PR workflow.

The current system has:
- Debate mode: agents propose, critique, vote in rounds with deadlock detection
- Collaborate mode: task decomposed into subtasks assigned by role, results integrated
- PR Workflow mode: debate a plan → implement with file/git tools → security review → open PR
- Web UI: real-time event streaming, credential management, permission approval flow
- Tools: FilesystemTool (sandboxed), TerminalTool (spawn-only allowlist), GitHubTool
- Permission engine: DB-backed rules, human-in-the-loop approval via WebSocket

Question for the agents: What are the most important next steps to make this platform 
genuinely useful for real engineering teams? Consider: user experience gaps, missing integrations, 
agent quality improvements, safety/trust mechanisms, and scalability. 
What should be built next, and who (which agent role) should own each piece?
`;

const payload = {
  task: TASK.trim(),
  mode: 'debate',
  agents: [
    { provider: 'anthropic', tier: 'fast', role: 'architect' },
    { provider: 'anthropic', tier: 'fast', role: 'devil_advocate' },
    { provider: 'anthropic', tier: 'fast', role: 'domain_expert' },
  ],
  maxRounds: 2,
  budgetCap: 1.00,
};

console.log('Creating debate project...');
const create = await fetch(`${BASE}/projects`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});
const { projectId } = await create.json();
console.log(`Project ID: ${projectId}`);
console.log('Agents are debating...\n');

const events = [];
await new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://localhost:3000?projectId=${projectId}`);
  const timeout = setTimeout(() => { ws.close(); resolve(); }, 180_000);
  ws.on('message', (data) => {
    const e = JSON.parse(data.toString());
    events.push(e);
    if (e.type === 'agent_thinking') process.stdout.write(`  [${e.role}] ${e.phase}...\n`);
    else if (e.type === 'round_started') console.log(`\n--- Round ${e.round} ---`);
    else if (e.type === 'round_complete') console.log(`  Round ${e.round} complete`);
    else if (e.type === 'synthesis_started') console.log('\n  Building consensus report...');
    else if (e.type === 'deliberation_complete') {
      clearTimeout(timeout);
      ws.close();
      resolve();
    }
  });
  ws.on('error', reject);
});

// Fetch final report
const project = await fetch(`${BASE}/projects/${projectId}`).then(r => r.json());
const report = project.report;

if (!report) { console.error('No report!'); process.exit(1); }

console.log('\n═══════════════════════════════════════════════════════');
console.log('CONSENSUS AI — MULTI-AGENT DEBATE RESULTS');
console.log('═══════════════════════════════════════════════════════\n');

const c = report.consensus;
console.log(`Consensus: ${c.reached ? '✓ REACHED' : '⚡ PARTIAL'} (${report.rounds} rounds, $${report.totalCostUsd.toFixed(4)})\n`);
console.log('RECOMMENDATION:');
console.log(c.recommendation);

if (c.dissent?.length > 0) {
  console.log('\nDISSENT:');
  c.dissent.forEach(d => console.log(`  • ${d}`));
}

if (c.blockingObjections?.length > 0) {
  console.log('\nBLOCKING OBJECTIONS:');
  c.blockingObjections.forEach(o => console.log(`  ⚠ ${o}`));
}

console.log('\n───────────────────────────────────────────────────────');
console.log('AGENT POSITIONS:');
for (const pos of report.positions) {
  console.log(`\n[${pos.agentRole.toUpperCase().replace(/_/g,' ')}] (${Math.round(pos.proposal.confidence*100)}% confidence)`);
  if (pos.finalVote) console.log(`  Vote: ${pos.finalVote.vote} — ${pos.finalVote.rationale}`);
  console.log(`  ${pos.proposal.recommendation}`);
  if (pos.proposal.reasoning?.length > 0) {
    console.log('  Reasoning:');
    pos.proposal.reasoning.slice(0,3).forEach(r => console.log(`    • ${r}`));
  }
  if (pos.proposal.risks?.length > 0) {
    console.log('  Risks:');
    pos.proposal.risks.slice(0,2).forEach(r => console.log(`    ⚠ ${r}`));
  }
}

if (report.riskSummary?.length > 0) {
  console.log('\n───────────────────────────────────────────────────────');
  console.log('RISK SUMMARY:');
  report.riskSummary.forEach(r => console.log(`  [${r.severity.toUpperCase()}] ${r.description} (raised by ${r.raisedBy})`));
}

console.log('\n═══════════════════════════════════════════════════════');

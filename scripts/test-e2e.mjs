import WebSocket from 'ws';

const BASE = process.env.API_URL ?? 'http://localhost:3000';

async function check(label, fn) {
  try {
    await fn();
    console.log(`✓ ${label}`);
  } catch (err) {
    console.error(`✗ ${label}: ${err.message}`);
    process.exit(1);
  }
}

// 1. Health check
await check('GET /health returns ok', async () => {
  const resp = await fetch(`${BASE}/health`);
  const body = await resp.json();
  if (body.status !== 'ok') throw new Error(`Expected ok, got ${body.status}`);
});

// 2. Create debate project
let projectId;
await check('POST /projects creates debate project', async () => {
  const resp = await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      task: 'Design a REST API for a simple todo application',
      mode: 'debate',
      agents: [
        { provider: 'anthropic', tier: 'fast', role: 'architect' },
        { provider: 'anthropic', tier: 'fast', role: 'devil_advocate' },
      ],
      maxRounds: 2,
      budgetCap: 1.0,
    }),
  });
  const body = await resp.json();
  if (!body.projectId) throw new Error('No projectId in response');
  projectId = body.projectId;
});

// 3. Stream WebSocket events
const events = [];
await check('WebSocket streams expected events', () => new Promise((resolve, reject) => {
  const wsUrl = `ws://localhost:3000?projectId=${projectId}`;
  const ws = new WebSocket(wsUrl);
  const timeout = setTimeout(() => {
    ws.close();
    reject(new Error(`Timeout — received events: ${events.map(e => e.type).join(', ')}`));
  }, 120_000);

  ws.on('message', (data) => {
    const event = JSON.parse(data.toString());
    events.push(event);
    console.log(`  WS event: ${event.type}`);
    if (event.type === 'deliberation_complete') {
      clearTimeout(timeout);
      ws.close();
      resolve();
    }
  });

  ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
}));

// 4. Verify event sequence
await check('Event sequence correct', async () => {
  const types = events.map(e => e.type);
  const required = ['round_started', 'agent_thinking', 'agent_position_ready', 'round_complete', 'synthesis_started', 'deliberation_complete'];
  for (const req of required) {
    if (!types.includes(req)) throw new Error(`Missing event: ${req}`);
  }
});

// 5. Verify report shape
await check('Report has structured arrays', async () => {
  const complete = events.find(e => e.type === 'deliberation_complete');
  const report = complete.report;
  for (const pos of report.positions) {
    if (!Array.isArray(pos.proposal.reasoning)) throw new Error('reasoning is not array');
    if (!Array.isArray(pos.proposal.assumptions)) throw new Error('assumptions is not array');
    if (!Array.isArray(pos.proposal.risks)) throw new Error('risks is not array');
  }
});

// 6. Verify GET /projects/:id
await check('GET /projects/:id returns complete status', async () => {
  // Poll until complete (max 10s after WS closed)
  for (let i = 0; i < 10; i++) {
    const resp = await fetch(`${BASE}/projects/${projectId}`);
    const body = await resp.json();
    if (body.status === 'complete') return;
    if (body.status === 'error') throw new Error('Project errored');
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Project did not reach complete status');
});

console.log('\n✓ All Phase B checks passed!');

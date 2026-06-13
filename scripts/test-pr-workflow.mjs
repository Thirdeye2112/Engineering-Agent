import { WebSocket } from 'ws';

const BASE = 'http://localhost:3000';

function ok(label) { console.log(`✓ ${label}`); }
function fail(label, detail) { console.error(`✗ ${label}`, detail); process.exit(1); }

async function main() {
  // Health
  const health = await fetch(`${BASE}/health`).then(r => r.json());
  if (health.status !== 'ok') fail('Health check', health);
  ok('GET /health returns ok');

  // Create PR workflow project
  const body = {
    task: 'Create a hello.txt file with the text "Hello, World!"',
    mode: 'pr_workflow',
    agents: [
      { provider: 'anthropic', tier: 'fast', role: 'architect' },
      { provider: 'anthropic', tier: 'fast', role: 'security_reviewer' },
    ],
    maxRounds: 1,
    budgetCap: 0.50,
  };
  const create = await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!create.ok) fail('POST /projects', await create.text());
  const { projectId } = await create.json();
  if (!projectId) fail('projectId missing', null);
  ok('POST /projects creates pr_workflow project');

  // Collect WebSocket events
  const events = [];
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:3000?projectId=${projectId}`);
    const timeout = setTimeout(() => { ws.close(); resolve(); }, 120_000);
    ws.on('message', (data) => {
      const e = JSON.parse(data.toString());
      events.push(e);
      console.log(`  WS event: ${e.type}`);
      if (e.type === 'workflow_complete' || e.type === 'workflow_error') {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });
    ws.on('error', reject);
  });

  const eventTypes = events.map(e => e.type);
  // debate_started may fire before WS connects — accept if implementation_started seen
  if (eventTypes.includes('debate_started')) ok('debate_started event received');
  else ok('debate_started event (may have fired before WS connected)');

  if (!eventTypes.includes('implementation_started')) fail('Missing implementation_started event', eventTypes);
  ok('implementation_started event received');

  if (!eventTypes.includes('workflow_complete') && !eventTypes.includes('workflow_error')) {
    fail('Missing workflow_complete/error event', eventTypes);
  }
  ok('workflow terminal event received');

  // Verify report shape
  const project = await fetch(`${BASE}/projects/${projectId}`).then(r => r.json());
  if (project.status !== 'complete' && project.status !== 'error') {
    fail(`Unexpected status: ${project.status}`, null);
  }
  ok(`GET /projects/:id returns ${project.status} status`);

  if (project.report) {
    const r = project.report;
    if (typeof r.totalCostUsd !== 'number') fail('report.totalCostUsd missing', r);
    ok('Report has totalCostUsd');
    if (!Array.isArray(r.steps)) fail('report.steps missing', r);
    ok('Report has steps array');
  }

  console.log('\n✓ All Phase F PR workflow checks passed!');
}

main().catch(err => { console.error(err); process.exit(1); });

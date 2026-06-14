import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlannerAgent } from '../planner-agent.js';
import { MockProvider, PLANNER_RESPONSE } from './mock-provider.js';

describe('PlannerAgent', () => {
  it('parses a well-formed planner response', async () => {
    const provider = new MockProvider(PLANNER_RESPONSE);
    const planner = new PlannerAgent(provider);

    const result = await planner.plan({
      repoDescription: 'A TypeScript API server',
    });

    assert.equal(result.tasks.length, 3);
    assert.equal(result.tasks[0].id, 'add-input-validation');
    assert.equal(result.tasks[0].priority, 'high');
    assert.ok(result.repoSummary.length > 0);
  });

  it('returns fallback task when response is unparseable', async () => {
    const provider = new MockProvider('this is not json at all');
    const planner = new PlannerAgent(provider);

    const result = await planner.plan({ repoDescription: 'test repo' });

    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].id, 'improve-test-coverage');
  });

  it('returns fallback when response has no tasks array', async () => {
    const provider = new MockProvider(JSON.stringify({ repoSummary: 'ok', tasks: [] }));
    const planner = new PlannerAgent(provider);

    const result = await planner.plan({ repoDescription: 'test repo' });

    assert.equal(result.tasks.length, 1); // fallback
  });

  it('includes completed/failed tasks in the prompt context', async () => {
    let capturedMessage = '';
    const provider = new MockProvider(PLANNER_RESPONSE);
    const origSend = provider.sendMessage.bind(provider);
    provider.sendMessage = async (req) => {
      capturedMessage = req.messages.find((m: { role: string }) => m.role === 'user')?.content ?? '';
      return origSend(req);
    };

    const planner = new PlannerAgent(provider);
    await planner.plan({
      repoDescription: 'test',
      completedTasks: ['Add slugify utility'],
      failedTasks: ['Fix broken thing'],
    });

    assert.ok(capturedMessage.includes('Add slugify utility'));
    assert.ok(capturedMessage.includes('Fix broken thing'));
  });

  it('makes exactly one API call per plan()', async () => {
    const provider = new MockProvider(PLANNER_RESPONSE);
    const planner = new PlannerAgent(provider);

    await planner.plan({ repoDescription: 'test' });

    assert.equal(provider.calls, 1);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AutoLoop } from '../auto-loop.js';
import type { AutoLoopEvent } from '../auto-loop.js';
import type { PlannedTask } from '../planner-agent.js';
import {
  MockProvider,
  PLANNER_RESPONSE,
  PROPOSAL_RESPONSE,
  CRITIQUE_RESPONSE,
  VOTE_RESPONSE,
  SYNTHESIS_RESPONSE,
} from './mock-provider.js';

// Patch createProvider so AutoLoop uses mock providers
import * as providerFactory from '../provider-factory.js';

function patchProviders(responses: string[]) {
  const mock = new MockProvider(responses);
  (providerFactory as any).createProvider = () => mock;
  return mock;
}

// Injectable memory overrides so AutoLoop doesn't need a real repo on disk
import type { RepoIntelligence } from '@consensus/memory';
const mockAnalyzeRepo = (): RepoIntelligence => ({
  packageManager: 'pnpm',
  isMonorepo: true,
  workspaces: [],
  testCommands: [],
  lintCommands: [],
  typecheckCommands: [],
  frameworks: [],
  protectedFiles: [],
  codeOwners: [],
  entryPoints: [],
  hasTypeScript: true,
  hasDockerfile: false,
  hasCiConfig: false,
  rawScripts: {},
});
const mockFormatRepo = () => 'Test repo with TypeScript.';

// Mock task executor — returns a fake PR URL immediately
const mockExecuteTask = async (_task: PlannedTask) => ({
  prUrl: 'https://github.com/test/repo/pull/42',
});

const mockExecuteTaskFail = async (_task: PlannedTask) => ({
  blockingObjections: ['Missing dependency'],
});

// Enough responses to cover: planner(1) + debate proposal(2) + critique(2) + vote(2) + synthesis(1)
const DEBATE_CYCLE_RESPONSES = [
  PLANNER_RESPONSE,
  PROPOSAL_RESPONSE,
  PROPOSAL_RESPONSE,
  CRITIQUE_RESPONSE,
  CRITIQUE_RESPONSE,
  VOTE_RESPONSE,
  VOTE_RESPONSE,
  SYNTHESIS_RESPONSE,
];

describe('AutoLoop', () => {
  it('runs a single iteration and emits expected events', async () => {
    patchProviders(DEBATE_CYCLE_RESPONSES.concat(Array(10).fill(PROPOSAL_RESPONSE)));

    const events: AutoLoopEvent[] = [];
    const loop = new AutoLoop({
      maxTasks: 1,
      repoFullName: 'test/repo',
      sandboxRoot: '/tmp/test-sandbox',
      pauseMs: 0,
      analyzeRepo: mockAnalyzeRepo,
      formatRepoIntelligenceForPrompt: mockFormatRepo,
      executeTask: mockExecuteTask,
      onEvent: (ev) => events.push(ev),
    });

    const result = await loop.run();

    const types = events.map(e => e.type);
    assert.ok(types.includes('loop_started'), 'should emit loop_started');
    assert.ok(types.includes('planning'), 'should emit planning');
    assert.ok(types.includes('tasks_proposed'), 'should emit tasks_proposed');
    assert.ok(types.includes('task_selected'), 'should emit task_selected');
    assert.ok(types.includes('loop_stopped'), 'should emit loop_stopped');

    assert.equal(result.stoppedReason, 'reached 1 completed tasks');
  });

  it('respects maxTasks limit', async () => {
    patchProviders(Array(50).fill(PLANNER_RESPONSE));

    let completedCount = 0;
    const loop = new AutoLoop({
      maxTasks: 2,
      repoFullName: 'test/repo',
      sandboxRoot: '/tmp/test',
      pauseMs: 0,
      analyzeRepo: mockAnalyzeRepo,
      formatRepoIntelligenceForPrompt: mockFormatRepo,
      executeTask: mockExecuteTask,
      onEvent: (ev) => {
        if (ev.type === 'task_complete') completedCount++;
      },
    });

    const result = await loop.run();
    assert.ok(result.completed <= 2, `completed ${result.completed} but max was 2`);
    assert.equal(result.completed, 2);
  });

  it('stop() halts the loop gracefully', async () => {
    patchProviders(Array(100).fill(PLANNER_RESPONSE));

    const events: AutoLoopEvent[] = [];
    const loop = new AutoLoop({
      maxTasks: null, // unlimited
      repoFullName: 'test/repo',
      sandboxRoot: '/tmp/test',
      pauseMs: 0,
      analyzeRepo: mockAnalyzeRepo,
      formatRepoIntelligenceForPrompt: mockFormatRepo,
      executeTask: mockExecuteTask,
      onEvent: (ev) => {
        events.push(ev);
        // Stop after first planning event
        if (ev.type === 'planning') loop.stop('test-stop');
      },
    });

    const result = await loop.run();
    assert.equal(result.stoppedReason, 'manual stop');
  });

  it('proposed tasks include repo summary in event', async () => {
    patchProviders(DEBATE_CYCLE_RESPONSES.concat(Array(10).fill(PROPOSAL_RESPONSE)));

    let proposedEvent: AutoLoopEvent | null = null;
    const loop = new AutoLoop({
      maxTasks: 1,
      repoFullName: 'test/repo',
      sandboxRoot: '/tmp/test',
      pauseMs: 0,
      analyzeRepo: mockAnalyzeRepo,
      formatRepoIntelligenceForPrompt: mockFormatRepo,
      executeTask: mockExecuteTask,
      onEvent: (ev) => {
        if (ev.type === 'tasks_proposed') proposedEvent = ev;
      },
    });

    await loop.run();

    assert.ok(proposedEvent !== null, 'tasks_proposed event should fire');
    const ev = proposedEvent as Extract<AutoLoopEvent, { type: 'tasks_proposed' }>;
    assert.ok(ev.tasks.length > 0);
    assert.ok(ev.repoSummary.length > 0);
  });

  it('continues after a failed task and records failure', async () => {
    let callCount = 0;
    const executeTask = async (_task: PlannedTask) => {
      callCount++;
      // First call fails, second succeeds
      return callCount === 1
        ? { blockingObjections: ['Missing dependency'] }
        : { prUrl: 'https://github.com/test/repo/pull/42' };
    };

    patchProviders(Array(50).fill(PLANNER_RESPONSE));

    const events: AutoLoopEvent[] = [];
    const loop = new AutoLoop({
      maxTasks: 1,
      repoFullName: 'test/repo',
      sandboxRoot: '/tmp/test',
      pauseMs: 0,
      analyzeRepo: mockAnalyzeRepo,
      formatRepoIntelligenceForPrompt: mockFormatRepo,
      executeTask,
      onEvent: (ev) => events.push(ev),
    });

    const result = await loop.run();
    assert.ok(events.some(e => e.type === 'task_failed'), 'should emit task_failed');
    assert.ok(events.some(e => e.type === 'task_complete'), 'should eventually complete');
    assert.ok(result.failed >= 1);
    assert.equal(result.completed, 1);
  });
});

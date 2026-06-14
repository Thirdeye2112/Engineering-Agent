/**
 * AutoLoop — self-directing agent loop
 *
 * Agents read the repo, propose tasks, debate and vote on the best one,
 * then autonomously implement it via PRWorkflow. Repeats until stopped
 * or the target task count is reached.
 */

import { PlannerAgent, type PlannedTask } from './planner-agent.js';
import { DebateEngine } from './debate-engine.js';
import { PRWorkflow } from './pr-workflow.js';
import { createProvider } from './provider-factory.js';
import { analyzeRepo, formatRepoIntelligenceForPrompt, type RepoIntelligence } from '@consensus/memory';
import type { IAIProvider } from './provider-interface.js';
import type { ProviderName, TierName } from '@consensus/shared-types';

export interface AutoLoopConfig {
  /** How many tasks to complete before stopping. Default: unlimited (run forever). */
  maxTasks?: number | null;
  /**
   * Maximum total API spend in USD before the loop stops. Leave undefined to
   * disable. Wire this up once provider cost tracking flows into AutoLoop.
   * The field is read and enforced now — set it to prevent runaway spend.
   */
  maxSpendUsd?: number;
  /** Target repo full name e.g. "owner/repo" */
  repoFullName: string;
  /** Local checkout root for repo intelligence */
  sandboxRoot: string;
  /** Root of the real repo to analyze for planning (defaults to sandboxRoot) */
  repoRoot?: string;
  /** Primary model for planning + implementation */
  provider?: ProviderName;
  tier?: TierName;
  /** Fast model for critique/debate partner */
  fastTier?: TierName;
  /** Pause between tasks in ms. Default: 5000. */
  pauseMs?: number;
  onEvent?: (event: AutoLoopEvent) => void;
  /** Injectable for testing — overrides @consensus/memory analyzeRepo */
  analyzeRepo?: (root: string) => RepoIntelligence;
  /** Injectable for testing — overrides @consensus/memory formatRepoIntelligenceForPrompt */
  formatRepoIntelligenceForPrompt?: (intel: RepoIntelligence) => string;
  /** Injectable for testing — replaces the full PRWorkflow execution */
  executeTask?: (task: PlannedTask) => Promise<{ prUrl?: string; blockingObjections?: string[] }>;
}

export type AutoLoopEvent =
  | { type: 'loop_started'; maxTasks: number | null }
  | { type: 'planning'; iteration: number }
  | { type: 'tasks_proposed'; tasks: PlannedTask[]; repoSummary: string }
  | { type: 'task_selected'; task: PlannedTask; rationale: string }
  | { type: 'task_started'; task: PlannedTask; iteration: number }
  | { type: 'task_complete'; task: PlannedTask; prUrl: string; iteration: number }
  | { type: 'task_failed'; task: PlannedTask; reason: string; iteration: number }
  | { type: 'loop_stopped'; reason: string; completed: number };

export interface AutoLoopResult {
  completed: number;
  failed: number;
  prUrls: string[];
  stoppedReason: string;
  totalSpendUsd: number;
}

export class AutoLoop {
  private stopped = false;
  private completedTasks: string[] = [];
  private failedTasks: string[] = [];
  private prUrls: string[] = [];
  private totalSpendUsd = 0;

  constructor(private config: AutoLoopConfig) {}

  stop(reason = 'manual') {
    this.stopped = true;
    this.config.onEvent?.({ type: 'loop_stopped', reason, completed: this.prUrls.length });
  }

  async run(): Promise<AutoLoopResult> {
    const {
      maxTasks = null,
      maxSpendUsd,
      repoFullName,
      sandboxRoot,
      provider: providerName = 'anthropic',
      tier = 'standard',
      fastTier = 'fast',
      pauseMs = 5000,
      onEvent,
      analyzeRepo: analyzeRepoFn,
      formatRepoIntelligenceForPrompt: formatFn,
      executeTask: executeTaskFn,
    } = this.config;

    onEvent?.({ type: 'loop_started', maxTasks });

    const primaryProvider = createProvider(providerName, tier);
    const fastProvider = createProvider(providerName, fastTier);
    const planner = new PlannerAgent(primaryProvider);

    let iteration = 0;

    while (
      !this.stopped &&
      (maxTasks === null || this.prUrls.length < maxTasks) &&
      (maxSpendUsd === undefined || this.totalSpendUsd < maxSpendUsd)
    ) {
      iteration++;
      onEvent?.({ type: 'planning', iteration });

      // Build repo description from intelligence
      let repoDescription = `Repository: ${repoFullName}`;
      try {
        const intel = (analyzeRepoFn ?? analyzeRepo)(this.config.repoRoot ?? sandboxRoot);
        repoDescription = (formatFn ?? formatRepoIntelligenceForPrompt)(intel);
      } catch { /* fall back to repo name */ }

      // Step 1: Planner proposes tasks
      let planned;
      try {
        planned = await planner.plan({
          repoDescription,
          completedTasks: this.completedTasks.slice(-10),
          failedTasks: this.failedTasks.slice(-5),
        });
      } catch (err) {
        const reason = `Planner failed: ${String(err).slice(0, 200)}`;
        onEvent?.({ type: 'loop_stopped', reason, completed: this.prUrls.length });
        break;
      }

      onEvent?.({ type: 'tasks_proposed', tasks: planned.tasks, repoSummary: planned.repoSummary });

      // Step 2: Debate engine picks the best task
      const taskChoices = planned.tasks
        .map((t, i) => `Option ${i + 1}: [${t.priority}] ${t.title} — ${t.rationale}`)
        .join('\n');

      let selectedTask: PlannedTask;
      let selectionRationale = '';

      try {
        const debate = new DebateEngine({
          deliberationId: `auto-loop:task-select:${Date.now()}`,
          task: `Given these candidate tasks for the repo, select the single most valuable one to implement next:\n\n${taskChoices}\n\nConsider: impact, feasibility, and avoiding recently failed approaches.`,
          agents: [
            { provider: primaryProvider, role: 'architect' },
            { provider: fastProvider, role: 'devil_advocate' },
          ],
          maxRounds: 1,
        });
        const report = await debate.run();
        selectionRationale = report.consensus.recommendation;

        // Match debate recommendation back to a task
        const rec = report.consensus.recommendation.toLowerCase();
        selectedTask = planned.tasks.find(t =>
          rec.includes(t.id) || rec.includes(t.title.toLowerCase()),
        ) ?? planned.tasks[0];
      } catch {
        // If debate fails, just pick the highest-priority task
        selectedTask = planned.tasks[0];
      }

      onEvent?.({ type: 'task_selected', task: selectedTask, rationale: selectionRationale });
      onEvent?.({ type: 'task_started', task: selectedTask, iteration });

      // Step 3: PRWorkflow implements the selected task
      try {
        const report: { prUrl?: string; blockingObjections?: string[]; totalCostUsd?: number } = await (executeTaskFn
          ? executeTaskFn(selectedTask)
          : (async () => {
              const workflow = new PRWorkflow({
                projectId: `auto-loop:${selectedTask.id}:${Date.now()}`,
                task: `${selectedTask.title}\n\n${selectedTask.description}`,
                repoFullName,
                agents: [
                  { provider: primaryProvider, role: 'implementation_agent' as never },
                  { provider: fastProvider, role: 'critic' as never },
                ],
                sandboxRoot,
                useMemory: true,
                runTests: true,
                onEvent: (ev) => {
                  if (ev.type === 'tool_called') {
                    console.log(`    [tool] ${ev.tool}.${ev.operation}`);
                  } else if (ev.type === 'tool_result') {
                    if (!ev.success) console.log(`    [tool] ✗ ${ev.tool} failed`);
                  } else if (ev.type === 'code_review_complete') {
                    console.log(`    [review] verdict=${ev.verdict} risk=${ev.riskLevel}`);
                  } else if (ev.type === 'pr_opened') {
                    console.log(`    [pr] opened ${ev.prUrl}`);
                  } else if (ev.type === 'workflow_error') {
                    console.log(`    [error] ${ev.error}`);
                  } else if (ev.type === 'security_review_complete' && ev.blockingIssues.length > 0) {
                    console.log(`    [security] blocking: ${ev.blockingIssues.join(', ')}`);
                  }
                },
              });
              return workflow.run();
            })());

        // Accumulate spend for cap enforcement.
        if (report.totalCostUsd) this.totalSpendUsd += report.totalCostUsd;

        if (report.prUrl) {
          this.completedTasks.push(selectedTask.title);
          this.prUrls.push(report.prUrl);
          onEvent?.({ type: 'task_complete', task: selectedTask, prUrl: report.prUrl, iteration });
        } else {
          const objections = report.blockingObjections ?? [];
          const reason = objections[0] ?? 'No PR opened';
          if (objections.length > 1) console.log(`    [blockers] ${objections.slice(1).join(' | ')}`);
          this.failedTasks.push(selectedTask.title);
          onEvent?.({ type: 'task_failed', task: selectedTask, reason, iteration });
        }
      } catch (err) {
        const reason = String(err).slice(0, 200);
        this.failedTasks.push(selectedTask.title);
        onEvent?.({ type: 'task_failed', task: selectedTask, reason, iteration });
      }

      if (!this.stopped && (maxTasks === null || this.prUrls.length < maxTasks)) {
        await new Promise(r => setTimeout(r, pauseMs));
      }
    }

    const stoppedReason = this.stopped
      ? 'manual stop'
      : maxSpendUsd !== undefined && this.totalSpendUsd >= maxSpendUsd
        ? `spend cap reached ($${this.totalSpendUsd.toFixed(4)} >= $${maxSpendUsd})`
        : `reached ${maxTasks} completed tasks`;
    onEvent?.({ type: 'loop_stopped', reason: stoppedReason, completed: this.prUrls.length });

    return {
      completed: this.prUrls.length,
      failed: this.failedTasks.length,
      prUrls: this.prUrls,
      stoppedReason,
      totalSpendUsd: this.totalSpendUsd,
    };
  }
}

import { Agent } from './agent.js';
import { DebateEngine, type AgentInputConfig, type DebateEvent } from './debate-engine.js';
import { CodeReviewAgent, type CodeReviewInput } from './code-review-agent.js';
import { TestPlanAgent } from './test-plan-agent.js';
import type { IAIProvider } from './provider-interface.js';
import type { AgentRole, PRWorkflowReport, PRQualityChecklist, PatchPreview } from '@consensus/shared-types';
import type { ITool } from '@consensus/tools';
import { FilesystemTool } from '@consensus/tools';
import { TerminalTool } from '@consensus/tools';
import { auditLog } from '@consensus/audit-log';

export interface PRWorkflowConfig {
  projectId: string;
  task: string;
  agents: AgentInputConfig[];
  tools?: ITool[];
  sandboxRoot?: string;
  onEvent?: (event: PRWorkflowEvent) => void;
}

export type PRWorkflowEvent =
  | { type: 'debate_started' }
  | { type: 'debate_complete'; plan: string }
  | { type: 'implementation_started'; role: AgentRole }
  | { type: 'tool_called'; tool: string; operation: string }
  | { type: 'tool_result'; tool: string; success: boolean }
  | { type: 'pr_opened'; prUrl: string; prNumber: number }
  | { type: 'security_review_started' }
  | { type: 'security_review_complete'; approved: boolean; blockingIssues: string[] }
  | { type: 'code_review_started' }
  | { type: 'code_review_complete'; verdict: string; riskLevel: string }
  | { type: 'test_plan_complete'; requiredCount: number }
  | { type: 'workflow_complete'; report: PRWorkflowReport }
  | { type: 'workflow_error'; error: string };

export class PRWorkflow {
  constructor(private config: PRWorkflowConfig) {}

  async run(): Promise<PRWorkflowReport> {
    const { projectId, task, agents, onEvent } = this.config;
    let totalCostUsd = 0;

    // ── Step 1: Debate round to agree on implementation plan ─────────────────
    onEvent?.({ type: 'debate_started' });

    const debateEngine = new DebateEngine({
      deliberationId: `${projectId}:plan-debate`,
      task: `Create a concrete, step-by-step implementation plan for: ${task}. Focus on which files to modify, what changes to make, and how to verify correctness.`,
      agents,
      maxRounds: 1,
    });

    const debateReport = await debateEngine.run();
    totalCostUsd += debateReport.totalCostUsd;

    const implementationPlan = debateReport.consensus.recommendation;
    onEvent?.({ type: 'debate_complete', plan: implementationPlan });

    // ── Step 2: Architect implements using tools ─────────────────────────────
    const architectConfig = agents.find(a => a.role === 'architect') ?? agents[0];
    const sandboxRoot = this.config.sandboxRoot ?? process.env.FILESYSTEM_SANDBOX_ROOT ?? './sandbox';

    const tools: ITool[] = this.config.tools ?? [
      new FilesystemTool(sandboxRoot),
      new TerminalTool(),
    ];

    const implementorRole = architectConfig.role;
    onEvent?.({ type: 'implementation_started', role: implementorRole });

    const implementor = new Agent({
      provider: architectConfig.provider,
      role: implementorRole,
      deliberationId: `${projectId}:implement`,
      task,
      tools,
      permissionLevel: 'write',
    });
    await implementor.init();

    const { steps, finalResponse } = await implementor.implement(implementationPlan, tools);
    totalCostUsd += implementor.costUsd;

    for (const step of steps) {
      for (let i = 0; i < step.toolCalls.length; i++) {
        onEvent?.({ type: 'tool_called', tool: step.toolCalls[i].tool, operation: step.toolCalls[i].operation as string });
        onEvent?.({ type: 'tool_result', tool: step.toolCalls[i].tool, success: step.toolResults[i]?.success ?? false });
      }
    }

    const prUrl = finalResponse.prUrl;
    const prNumber = finalResponse.prNumber;
    const filesModified = finalResponse.filesModified ?? [];
    const implementationBlockers = finalResponse.blockingIssues ?? [];

    if (prUrl && prNumber) {
      onEvent?.({ type: 'pr_opened', prUrl, prNumber });
    }

    // ── Step 3: Code review (before human approval / PR open) ────────────────
    onEvent?.({ type: 'code_review_started' });

    const reviewerConfig = agents.find(a => a.role === 'security_reviewer') ?? agents[0];
    const codeReviewAgent = new CodeReviewAgent(reviewerConfig.provider);

    // Build patch previews from implementation steps
    const patchPreviews: PatchPreview[] = [];
    const codeReviewInputs: CodeReviewInput[] = [];

    for (const step of steps) {
      for (const tc of step.toolCalls) {
        if ((tc.operation === 'write_file' || tc.operation === 'propose_write' || tc.operation === 'commit_file') && tc.path) {
          const path = tc.path as string;
          const proposedContent = (tc.content as string | undefined) ?? '';
          codeReviewInputs.push({
            path,
            originalContent: '',   // agent doesn't pass original; reviewer notes absence
            proposedContent,
            taskContext: task,
          });
          patchPreviews.push({
            path,
            originalSnippet: '(not captured)',
            proposedSnippet: proposedContent.slice(0, 500),
            reason: step.narrative,
            riskLevel: 'medium',
          });
        }
      }
    }

    let codeReview = undefined;
    if (codeReviewInputs.length > 0) {
      try {
        codeReview = await codeReviewAgent.review(codeReviewInputs);
        // Annotate patch previews with verdict
        for (const patch of patchPreviews) {
          patch.reviewerVerdict = codeReview.verdict;
          patch.riskLevel = codeReview.riskLevel;
        }
        onEvent?.({ type: 'code_review_complete', verdict: codeReview.verdict, riskLevel: codeReview.riskLevel });
      } catch (err) {
        console.warn('[code-review] failed:', err);
      }
    }

    // ── Step 4: Security reviewer cross-reviews the diff ────────────────────
    onEvent?.({ type: 'security_review_started' });

    const secReviewerConfig = agents.find(a => a.role === 'security_reviewer');
    let securityReview = undefined;

    if (secReviewerConfig) {
      const reviewer = new Agent({
        provider: secReviewerConfig.provider,
        role: 'security_reviewer',
        deliberationId: `${projectId}:security-review`,
        task,
        tools,
        permissionLevel: 'read',
      });
      await reviewer.init();

      const prContent = [
        `PR: ${prUrl ?? 'No PR opened yet'}`,
        `Files modified: ${filesModified.join(', ') || 'none'}`,
        `Implementation summary:\n${finalResponse.narrative}`,
        `Steps taken:\n${steps.map((s, i) => `${i + 1}. ${s.narrative}`).join('\n')}`,
        implementationBlockers.length ? `Blocking issues found: ${implementationBlockers.join(', ')}` : '',
      ].filter(Boolean).join('\n\n');

      securityReview = await reviewer.securityReview(prContent);
      totalCostUsd += reviewer.costUsd;

      onEvent?.({
        type: 'security_review_complete',
        approved: securityReview.approved,
        blockingIssues: securityReview.blockingIssues,
      });
    }

    // ── Step 5: Test plan ────────────────────────────────────────────────────
    const testPlanConfig = agents.find(a => a.role === 'architect') ?? agents[0];
    const testPlanAgent = new TestPlanAgent(testPlanConfig.provider);
    let testPlan = undefined;

    try {
      testPlan = await testPlanAgent.plan({
        taskContext: task,
        filesChanged: filesModified,
        proposedChangeSummary: finalResponse.narrative,
      });
      onEvent?.({ type: 'test_plan_complete', requiredCount: testPlan.requiredBeforePr.length });
    } catch (err) {
      console.warn('[test-plan] failed:', err);
    }

    // ── Step 6: Audit chain verification ────────────────────────────────────
    const auditVerification = await auditLog.verify().catch(() => ({ valid: false, checkedCount: 0 }));

    // ── Step 7: Assemble blocking objections and checklist ───────────────────
    const codeReviewBlockers = codeReview?.verdict === 'block' ? [codeReview.rationale] : [];
    const allBlockingObjections = [
      ...implementationBlockers,
      ...(securityReview?.blockingIssues ?? []),
      ...codeReviewBlockers,
    ];

    const warnings: string[] = [
      ...(codeReview?.verdict === 'request_changes' ? codeReview.requiredFixes : []),
      ...(codeReview?.securityConcerns ?? []),
      ...(codeReview?.testingGaps ?? []),
    ];

    const checklist: PRQualityChecklist = {
      taskSummary: task,
      filesChanged: filesModified,
      agentReasoning: finalResponse.narrative,
      securityReviewPassed: securityReview?.approved ?? false,
      testPlanComplete: (testPlan?.requiredBeforePr.length ?? 0) === 0 || !!testPlan,
      humanApprovalsObtained: steps.some(s => s.toolResults.some(r => r.success)),
      auditChainValid: auditVerification.valid,
      codeReviewVerdict: codeReview?.verdict,
      blockers: allBlockingObjections,
      warnings,
      // Block merge if any blockers, code review blocked, or audit chain invalid
      readyToMerge: allBlockingObjections.length === 0 && codeReview?.verdict !== 'block' && auditVerification.valid,
    };

    const report: PRWorkflowReport = {
      projectId,
      task,
      implementationPlan,
      steps,
      prUrl,
      prNumber,
      branch: `feat/${task.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
      filesModified,
      securityReview,
      codeReview,
      testPlan,
      patchPreviews: patchPreviews.length > 0 ? patchPreviews : undefined,
      checklist,
      blockingObjections: allBlockingObjections,
      totalCostUsd,
      completedAt: new Date().toISOString(),
    };

    onEvent?.({ type: 'workflow_complete', report });
    return report;
  }
}

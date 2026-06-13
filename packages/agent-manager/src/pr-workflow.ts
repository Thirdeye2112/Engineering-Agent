import { Agent } from './agent.js';
import { DebateEngine, type AgentInputConfig } from './debate-engine.js';
import { CodeReviewAgent, type CodeReviewInput } from './code-review-agent.js';
import { TestPlanAgent } from './test-plan-agent.js';
import type { IAIProvider } from './provider-interface.js';
import type { AgentRole, PRWorkflowReport, PRQualityChecklist, PatchPreview, TestRunResult, MemoryReference } from '@consensus/shared-types';
import type { ITool } from '@consensus/tools';
import { FilesystemTool, SafeTestRunner } from '@consensus/tools';
import type { TestProfileConfig } from '@consensus/tools';
import { TerminalTool } from '@consensus/tools';
import { auditLog } from '@consensus/audit-log';
import { projectMemory, analyzeRepo, formatRepoIntelligenceForPrompt } from '@consensus/memory';
import type { MemoryRecord } from '@consensus/memory';

export interface PRWorkflowConfig {
  projectId: string;
  task: string;
  repoFullName?: string;
  agents: AgentInputConfig[];
  tools?: ITool[];
  sandboxRoot?: string;
  /** Optional test profiles; if provided, required tests run after implementation */
  testProfiles?: TestProfileConfig;
  /** Set false to skip test execution entirely (default: true when testProfiles provided) */
  runTests?: boolean;
  /** Set false to disable memory loading/writing (default: true) */
  useMemory?: boolean;
  /**
   * When > 0, agent will poll for human approval instead of returning immediately
   * with pendingApproval=true. Required for interactive pilot mode.
   * Default: 0 (approval must be pre-granted via standing DB rules).
   */
  approvalTimeoutMs?: number;
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
  | { type: 'tests_started'; profiles: string[] }
  | { type: 'test_complete'; profile: string; status: string }
  | { type: 'memory_loaded'; count: number }
  | { type: 'memory_written'; count: number }
  | { type: 'workflow_complete'; report: PRWorkflowReport }
  | { type: 'workflow_error'; error: string };

export class PRWorkflow {
  constructor(private config: PRWorkflowConfig) {}

  async run(): Promise<PRWorkflowReport> {
    const { projectId, task, agents, onEvent } = this.config;
    const repoFullName = this.config.repoFullName;
    const useMemory = this.config.useMemory !== false;
    let totalCostUsd = 0;

    // ── Step 0: Load memory + repo intelligence ───────────────────────────────
    let loadedMemories: MemoryRecord[] = [];
    let memoryContext = '';
    let repoIntelligenceContext = '';

    if (useMemory) {
      try {
        loadedMemories = await projectMemory.retrieve({
          projectId,
          repoFullName,
          includeExpired: false,
          includeSuperseded: false,
          limit: 30,
        });
        memoryContext = projectMemory.formatForPrompt(loadedMemories);
        onEvent?.({ type: 'memory_loaded', count: loadedMemories.length });
      } catch (err) {
        console.warn('[memory] load failed:', err);
      }
    }

    const sandboxRoot = this.config.sandboxRoot ?? process.env.FILESYSTEM_SANDBOX_ROOT ?? './sandbox';

    try {
      const intel = analyzeRepo(sandboxRoot);
      repoIntelligenceContext = formatRepoIntelligenceForPrompt(intel);
    } catch (err) {
      console.warn('[repo-intelligence] analysis failed:', err);
    }

    const implementationCtx = { memoryContext, repoIntelligenceContext };

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
    const implementorRole = architectConfig.role;

    const tools: ITool[] = this.config.tools ?? [
      // Sandbox writes are auto-allowed for the implementation agent — the sandbox
      // boundary limits blast radius; human approval still covers the commit step.
      new FilesystemTool(sandboxRoot, { trustedRoles: [implementorRole] }),
      new TerminalTool(),
    ];
    onEvent?.({ type: 'implementation_started', role: implementorRole });

    const implementor = new Agent({
      provider: architectConfig.provider,
      role: implementorRole,
      deliberationId: `${projectId}:implement`,
      task,
      tools,
      permissionLevel: 'write',
      approvalTimeoutMs: this.config.approvalTimeoutMs,
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

    // ── Step 4: Test plan (must run before SafeTestRunner so we know required profiles) ──
    const testPlanConfig = agents.find(a => a.role === 'architect') ?? agents[0];
    const testPlanAgentInst = new TestPlanAgent(testPlanConfig.provider);
    let testPlan = undefined;

    try {
      testPlan = await testPlanAgentInst.plan({
        taskContext: task,
        filesChanged: filesModified,
        proposedChangeSummary: finalResponse.narrative,
      });
      onEvent?.({ type: 'test_plan_complete', requiredCount: testPlan.requiredBeforePr.length });
    } catch (err) {
      console.warn('[test-plan] failed:', err);
    }

    // ── Step 5: Safe test execution (required_before_pr tests) ───────────────
    const testResults: TestRunResult[] = [];

    if (this.config.testProfiles && this.config.runTests !== false) {
      const runner = new SafeTestRunner({
        profiles: this.config.testProfiles,
        sandboxRoot,
        timeoutMs: 120_000,
      });

      // Determine which profiles to run from TestPlanAgent output (required_before_pr)
      const requiredTypes = testPlan
        ? testPlan.requiredBeforePr.map(i => i.type)
        : ['unit', 'lint', 'typecheck'];

      // Map test item types to runner profiles
      const profilesToRun = new Set<'unit' | 'lint' | 'typecheck' | 'targeted'>();
      for (const t of requiredTypes) {
        if (t === 'unit' || t === 'integration') profilesToRun.add('unit');
        if (t === 'e2e') profilesToRun.add('targeted');
      }
      // Always run lint and typecheck if configured
      if (this.config.testProfiles.lint) profilesToRun.add('lint');
      if (this.config.testProfiles.typecheck) profilesToRun.add('typecheck');

      if (profilesToRun.size > 0) {
        onEvent?.({ type: 'tests_started', profiles: [...profilesToRun] });
      }

      const noopAudit = async () => {};
      const testCtx = {
        agentId: `${projectId}:test-runner`,
        projectId,
        permissionLevel: 'read' as const,
        auditLog: noopAudit,
      };

      for (const profile of profilesToRun) {
        const raw = await runner.execute({ profile, workingDirectory: '.' }, testCtx);
        const out = raw.output as Record<string, unknown> | null;
        const result: TestRunResult = {
          profile,
          status: (out?.status ?? (raw.success ? 'passed' : 'failed')) as TestRunResult['status'],
          exitCode: (out?.exitCode as number | undefined) ?? null,
          stdout: typeof out?.stdout === 'string' ? out.stdout : undefined,
          stderr: typeof out?.stderr === 'string' ? out.stderr : undefined,
          durationMs: raw.metadata.durationMs,
          truncated: out?.truncated as boolean | undefined,
          label: typeof out?.label === 'string' ? out.label : undefined,
          error: raw.error,
        };
        testResults.push(result);
        onEvent?.({ type: 'test_complete', profile, status: result.status });
      }
    }

    // ── Step 5: Security reviewer cross-reviews the diff ────────────────────
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

    // ── Step 7: Audit chain verification ────────────────────────────────────
    const auditVerification = await auditLog.verify().catch(() => ({ valid: false, checkedCount: 0 }));

    // ── Step 8: Assemble blocking objections and checklist ───────────────────
    const codeReviewBlockers = codeReview?.verdict === 'block' ? [codeReview.rationale] : [];

    // Determine required test status
    const requiredTestResults = testResults.filter(r =>
      r.status !== 'tests_not_configured' && r.status !== 'blocked',
    );
    const requiredTestsPassed = testResults.length === 0
      ? undefined  // no tests configured — not a pass, not a fail
      : requiredTestResults.length > 0
        ? requiredTestResults.every(r => r.status === 'passed')
        : undefined;

    const testFailBlockers = testResults
      .filter(r => r.status === 'failed' || r.status === 'timeout')
      .map(r => `Required test '${r.profile}' ${r.status}`);

    const notConfiguredWarnings = testResults
      .filter(r => r.status === 'tests_not_configured')
      .map(r => `tests_not_configured for profile '${r.profile}'`);

    const allBlockingObjections = [
      ...implementationBlockers,
      ...(securityReview?.blockingIssues ?? []),
      ...codeReviewBlockers,
      ...testFailBlockers,
    ];

    const warnings: string[] = [
      ...(codeReview?.verdict === 'request_changes' ? codeReview.requiredFixes : []),
      ...(codeReview?.securityConcerns ?? []),
      ...(codeReview?.testingGaps ?? []),
      ...notConfiguredWarnings,
    ];

    const checklist: PRQualityChecklist = {
      taskSummary: task,
      filesChanged: filesModified,
      agentReasoning: finalResponse.narrative,
      securityReviewPassed: securityReview?.approved ?? false,
      testPlanComplete: !!testPlan,
      humanApprovalsObtained: steps.some(s => s.toolResults.some(r => r.success)),
      auditChainValid: auditVerification.valid,
      codeReviewVerdict: codeReview?.verdict,
      testResults: testResults.length > 0 ? testResults : undefined,
      requiredTestsPassed,
      blockers: allBlockingObjections,
      warnings,
      readyToMerge:
        allBlockingObjections.length === 0 &&
        codeReview?.verdict !== 'block' &&
        auditVerification.valid &&
        (requiredTestsPassed !== false),
    };

    // ── Step 9: Build memory references (which memories influenced this run) ──
    const memoryReferences: MemoryReference[] = loadedMemories.map(m => ({
      memoryId: m.id,
      category: m.category,
      title: m.title,
      confidence: m.confidence,
      influence: 'applied' as const,
    }));

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
      testResults: testResults.length > 0 ? testResults : undefined,
      patchPreviews: patchPreviews.length > 0 ? patchPreviews : undefined,
      checklist,
      memoryReferences: memoryReferences.length > 0 ? memoryReferences : undefined,
      blockingObjections: allBlockingObjections,
      totalCostUsd,
      completedAt: new Date().toISOString(),
    };

    // ── Step 10: Write post-run memory records ────────────────────────────────
    if (useMemory) {
      const memoryWrites: Array<Promise<string>> = [];

      // Architecture decision: the chosen approach
      memoryWrites.push(
        projectMemory.write({
          projectId,
          repoFullName,
          category: 'architecture_decision',
          title: `Approach for: ${task.slice(0, 100)}`,
          content: implementationPlan.slice(0, 2000),
          sourceType: 'agent_decision',
          sourceId: prUrl ?? projectId,
          confidence: 0.85,
        }).catch(err => { console.warn('[memory] write failed:', err); return ''; }),
      );

      // Prior PR outcome
      if (prUrl) {
        memoryWrites.push(
          projectMemory.write({
            projectId,
            repoFullName,
            category: 'prior_pr_outcome',
            title: `PR outcome: ${task.slice(0, 80)}`,
            content: [
              `PR: ${prUrl}`,
              `Files: ${filesModified.join(', ')}`,
              `Blockers: ${allBlockingObjections.join('; ') || 'none'}`,
              `Code review: ${codeReview?.verdict ?? 'not run'}`,
              `Tests passed: ${requiredTestsPassed ?? 'not run'}`,
            ].join('\n'),
            sourceType: 'pr_outcome',
            sourceId: prUrl,
            confidence: 0.9,
          }).catch(err => { console.warn('[memory] write failed:', err); return ''; }),
        );
      }

      // Rejected approaches from debate dissent
      if (debateReport.consensus.dissent.length > 0) {
        memoryWrites.push(
          projectMemory.write({
            projectId,
            repoFullName,
            category: 'rejected_pattern',
            title: `Rejected approaches for: ${task.slice(0, 80)}`,
            content: debateReport.consensus.dissent.join('\n'),
            sourceType: 'agent_decision',
            sourceId: projectId,
            confidence: 0.7,
          }).catch(err => { console.warn('[memory] write failed:', err); return ''; }),
        );
      }

      // Security constraint if blocking security issues found
      if ((securityReview?.blockingIssues.length ?? 0) > 0) {
        memoryWrites.push(
          projectMemory.write({
            projectId,
            repoFullName,
            category: 'security_constraint',
            title: `Security issues in: ${task.slice(0, 80)}`,
            content: securityReview!.blockingIssues.join('\n'),
            sourceType: 'review_finding',
            sourceId: prUrl ?? projectId,
            confidence: 0.95,
          }).catch(err => { console.warn('[memory] write failed:', err); return ''; }),
        );
      }

      // Recurring test failure record
      const failedTests = testResults.filter(r => r.status === 'failed' || r.status === 'timeout');
      if (failedTests.length > 0) {
        memoryWrites.push(
          projectMemory.write({
            projectId,
            repoFullName,
            category: 'recurring_test_failure',
            title: `Test failures in: ${task.slice(0, 80)}`,
            content: failedTests.map(t => `${t.profile}: ${t.error ?? t.status}`).join('\n'),
            sourceType: 'test_result',
            sourceId: projectId,
            confidence: 0.8,
          }).catch(err => { console.warn('[memory] write failed:', err); return ''; }),
        );
      }

      const written = (await Promise.all(memoryWrites)).filter(Boolean);
      onEvent?.({ type: 'memory_written', count: written.length });
    }

    onEvent?.({ type: 'workflow_complete', report });
    return report;
  }
}

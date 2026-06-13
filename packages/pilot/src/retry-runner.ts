import type { PRWorkflowReport } from '@consensus/shared-types';
import type { PilotTask, PilotRunRecord, RunStatus } from './types.js';
import { FailureClassifier } from './failure-classifier.js';

export interface RetryRunnerDeps {
  runTask(task: PilotTask): Promise<{ report: PRWorkflowReport; elapsedMs: number; interventionPct: number; totalActions: number; humanInterventions: number; approvalsRequested: number; approvalsDenied: number; }>;
  onRetry?: (task: PilotTask, attempt: number, reason: string) => void;
}

export class RetryRunner {
  private classifier = new FailureClassifier();

  constructor(private deps: RetryRunnerDeps) {}

  async run(task: PilotTask, repo: string): Promise<PilotRunRecord> {
    const runId = `${task.id}-${Date.now()}`;
    const startedAt = new Date().toISOString();

    let attempt = 0;
    let lastResult: Awaited<ReturnType<RetryRunnerDeps['runTask']>> | null = null;
    let lastError: unknown = undefined;
    let retryCount = 0;

    while (attempt < 2) {
      attempt++;
      lastError = undefined;

      try {
        lastResult = await this.deps.runTask(task);
      } catch (err) {
        lastError = err;
        lastResult = null;
      }

      const report = lastResult?.report ?? this.emptyReport();
      const classification = this.classifier.classify(report, lastError);

      if (!classification) {
        // Success
        return this.buildRecord(runId, task, repo, startedAt, lastResult!, 'pr_opened', null, null, retryCount);
      }

      const { reason, detail } = classification;

      if (attempt === 1 && task.retryable && this.classifier.isRetryable(reason)) {
        retryCount = 1;
        this.deps.onRetry?.(task, 2, reason);
        continue;
      }

      const status: RunStatus = attempt === 1 ? 'failed' : 'retried_and_failed';
      return this.buildRecord(runId, task, repo, startedAt, lastResult ?? this.emptyRunResult(), status, reason, detail, retryCount);
    }

    // Should not reach here
    return this.buildRecord(runId, task, repo, startedAt, lastResult ?? this.emptyRunResult(), 'failed', 'agent_implementation_error', 'Max retries exceeded', retryCount);
  }

  private buildRecord(
    runId: string,
    task: PilotTask,
    repo: string,
    startedAt: string,
    result: RetryRunnerDeps['runTask'] extends (...args: any[]) => Promise<infer R> ? R : never,
    status: RunStatus,
    failureReason: import('./types.js').FailureReason | null,
    failureDetail: string | null,
    retryCount: number,
  ): PilotRunRecord {
    const report = result.report;
    const testResult = report.testResults?.[0];

    return {
      runId,
      taskId: task.id,
      taskLabel: task.label,
      repo,
      startedAt,
      completedAt: new Date().toISOString(),
      status,
      prUrl: report.prUrl ?? null,
      prNumber: report.prNumber ?? null,
      interventionPct: result.interventionPct,
      totalActions: result.totalActions,
      humanInterventions: result.humanInterventions,
      approvalsRequested: result.approvalsRequested,
      approvalsDenied: result.approvalsDenied,
      testStatus: (testResult?.status as PilotRunRecord['testStatus']) ?? 'skipped',
      testDurationMs: testResult?.durationMs ?? null,
      codeReviewVerdict: report.codeReview?.verdict ?? null,
      auditVerificationValid: report.checklist?.auditChainValid ?? true,
      elapsedMs: result.elapsedMs,
      failureReason,
      failureDetail,
      retryCount,
    };
  }

  private emptyReport(): PRWorkflowReport {
    return {
      projectId: '',
      task: '',
      implementationPlan: '',
      prUrl: null,
      prNumber: null,
      branch: null,
      filesModified: [],
      blockingObjections: [],
      totalCostUsd: 0,
      completedAt: new Date().toISOString(),
    } as unknown as PRWorkflowReport;
  }

  private emptyRunResult() {
    return {
      report: this.emptyReport(),
      elapsedMs: 0,
      interventionPct: 0,
      totalActions: 0,
      humanInterventions: 0,
      approvalsRequested: 0,
      approvalsDenied: 0,
    };
  }
}

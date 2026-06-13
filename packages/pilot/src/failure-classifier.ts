import type { PRWorkflowReport } from '@consensus/shared-types';
import type { FailureReason } from './types.js';

export interface ClassificationResult {
  reason: FailureReason;
  detail: string;
}

export class FailureClassifier {
  classify(report: PRWorkflowReport, thrownError?: unknown): ClassificationResult | null {
    // Not a failure
    if (report.prUrl && !thrownError) return null;

    const err = thrownError ? String(thrownError) : '';

    if (err.includes('onboard') || err.includes('analyzeRepo')) {
      return { reason: 'repo_onboarding_failure', detail: err.slice(0, 200) };
    }

    if (err.includes('MODULE_NOT_FOUND') || err.includes('Cannot find module') ||
        err.includes('ENOENT') || err.includes('missing_dependencies')) {
      return { reason: 'missing_dependencies', detail: err.slice(0, 200) };
    }

    if (
      report.testResults?.some(r => r.status === 'tests_not_configured') &&
      !report.testResults?.some(r => r.status === 'passed')
    ) {
      return { reason: 'test_command_unavailable', detail: 'No test command found or test runner failed to start' };
    }

    if (report.checklist?.blockers?.some(b => b.toLowerCase().includes('security'))) {
      return {
        reason: 'code_review_block',
        detail: report.checklist.blockers.join('; ').slice(0, 200),
      };
    }

    if (report.codeReview?.verdict === 'block') {
      return {
        reason: 'code_review_block',
        detail: `Code review blocked: ${report.codeReview.rationale?.slice(0, 180) ?? 'no rationale'}`,
      };
    }

    if (err.includes('permission') || err.includes('denied') || err.includes('approval')) {
      return { reason: 'permission_denial', detail: err.slice(0, 200) };
    }

    if (err.includes('github') || err.includes('GitHub') || err.includes('octokit') ||
        err.includes('rate limit') || err.includes('422') || err.includes('404')) {
      return { reason: 'github_api_error', detail: err.slice(0, 200) };
    }

    if (report.checklist && !report.checklist.auditChainValid) {
      return { reason: 'audit_verification_failure', detail: 'Audit hash chain verification failed' };
    }

    if (err.includes('memory') || err.includes('onboarding mismatch')) {
      return { reason: 'memory_repo_intelligence_mismatch', detail: err.slice(0, 200) };
    }

    if (report.testResults?.some(r => r.status === 'failed')) {
      return { reason: 'agent_implementation_error', detail: 'Tests failed after implementation' };
    }

    // Generic implementation failure
    const detail = report.blockingObjections?.join('; ') ?? err.slice(0, 200) ?? 'unknown error';
    return { reason: 'agent_implementation_error', detail };
  }

  /** Failures where a single retry is allowed. */
  isRetryable(reason: FailureReason): boolean {
    const RETRYABLE = new Set<FailureReason>([
      'agent_implementation_error',
      'test_command_unavailable',
    ]);
    return RETRYABLE.has(reason);
  }

  /** Failures that must not be retried (hard stop). */
  isHardStop(reason: FailureReason): boolean {
    const HARD = new Set<FailureReason>([
      'audit_verification_failure',
      'permission_denial',
      'code_review_block',
    ]);
    return HARD.has(reason);
  }
}

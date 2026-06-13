/**
 * Phase 8 / Milestone 1 — Pilot Hardening + Production Evaluation types
 */

export type FailureReason =
  | 'repo_onboarding_failure'
  | 'missing_dependencies'
  | 'test_command_unavailable'
  | 'agent_implementation_error'
  | 'code_review_block'
  | 'permission_denial'
  | 'github_api_error'
  | 'audit_verification_failure'
  | 'memory_repo_intelligence_mismatch';

export type RunStatus = 'pr_opened' | 'failed' | 'retried_and_passed' | 'retried_and_failed';

export interface PilotRunRecord {
  runId: string;
  taskId: string;
  taskLabel: string;
  repo: string;
  startedAt: string;
  completedAt: string;
  status: RunStatus;
  prUrl: string | null;
  prNumber: number | null;
  interventionPct: number;
  totalActions: number;
  humanInterventions: number;
  approvalsRequested: number;
  approvalsDenied: number;
  testStatus: 'passed' | 'failed' | 'tests_not_configured' | 'skipped';
  testDurationMs: number | null;
  codeReviewVerdict: 'approve' | 'request_changes' | 'block' | null;
  auditVerificationValid: boolean;
  elapsedMs: number;
  failureReason: FailureReason | null;
  failureDetail: string | null;
  retryCount: number;
  /** Populated asynchronously by OutcomeSyncer after PR is opened. */
  outcome: PROutcome | null;
}

export interface ScoreboardSummary {
  totalRuns: number;
  prOpenedCount: number;
  prOpenedPct: number;
  avgInterventionPct: number;
  maxInterventionPct: number;
  passedThresholdCount: number;
  failedThresholdCount: number;
  auditInvalidCount: number;
  unauthorizedWriteCount: number;
  failureBreakdown: Record<FailureReason, number>;
  // ── Milestone 1: Production Evaluation metrics ────────────────────────────
  /** Of PRs that reached pr_opened, how many were merged. */
  mergeRate: number;
  /** Of PRs that were reviewed, how many passed (approved or merged). */
  reviewPassRate: number;
  /** Of PRs that were merged, how many were subsequently reverted. */
  revertRate: number;
  /** Avg human intervention % across all runs (alias for avgInterventionPct). */
  avgInterventionRate: number;
  /** Avg ms from run start to PR opened (null if no PRs). */
  avgTimeToPrMs: number | null;
  /** Avg ms from PR opened to merge (null if no merges). */
  avgTimeToMergeMs: number | null;
  outcomeBreakdown: Record<OutcomeState, number>;
  generatedAt: string;
}

// ── Milestone 1: Production Evaluation ───────────────────────────────────────

/** Lifecycle state of a PR after it is opened by the agent. */
export type OutcomeState =
  | 'pr_opened'      // just opened, not yet reviewed
  | 'pr_reviewed'    // reviewer left comments / approval but not yet merged
  | 'pr_merged'      // merged into base branch
  | 'pr_rejected'    // closed without merging (human decision)
  | 'pr_abandoned'   // closed without merging (inactivity / bot close)
  | 'pr_reverted';   // a revert PR was opened after merge

export interface PROutcome {
  state: OutcomeState;
  reviewedAt: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  revertedAt: string | null;
  /** ms from PR open to first human review event */
  timeToReviewMs: number | null;
  /** ms from PR open to merge */
  timeToMergeMs: number | null;
  /** GitHub login of who merged / closed */
  resolvedBy: string | null;
  lastSyncedAt: string;
}

export interface PilotTask {
  id: string;
  label: string;
  description: string;
  prompt: string;
  expectedFiles: string[];
  retryable: boolean;
}

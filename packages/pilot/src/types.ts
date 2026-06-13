/**
 * Phase 8 — Pilot Hardening types
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
  generatedAt: string;
}

export interface PilotTask {
  id: string;
  label: string;
  description: string;
  prompt: string;
  expectedFiles: string[];
  retryable: boolean;
}

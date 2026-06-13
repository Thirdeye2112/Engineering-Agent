import { z } from 'zod';

export * from './collaboration.js';

export const AgentProposalSchema = z.object({
  recommendation: z.string(),
  reasoning: z.array(z.string()),
  assumptions: z.array(z.string()),
  risks: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type AgentProposal = z.infer<typeof AgentProposalSchema>;

export const AgentCritiqueSchema = z.object({
  targetAgentRole: z.string(),
  challengedReasoningIndexes: z.array(z.number()),
  objections: z.array(z.string()),
  agreements: z.array(z.string()),
  isBlocking: z.boolean(),
});
export type AgentCritique = z.infer<typeof AgentCritiqueSchema>;

export const VoteSchema = z.object({
  agentRole: z.string(),
  vote: z.enum(['accept', 'reject', 'abstain']),
  rationale: z.string(),
});
export type Vote = z.infer<typeof VoteSchema>;

export const RiskFlagSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string(),
  raisedBy: z.string(),
});
export type RiskFlag = z.infer<typeof RiskFlagSchema>;

export const AgentPositionSchema = z.object({
  agentRole: z.string(),
  provider: z.string(),
  proposal: AgentProposalSchema,
  critiques: z.array(AgentCritiqueSchema),
  finalVote: VoteSchema.optional(),
  riskFlags: z.array(RiskFlagSchema),
});
export type AgentPosition = z.infer<typeof AgentPositionSchema>;

export const DeliberationReportSchema = z.object({
  deliberationId: z.string(),
  task: z.string(),
  rounds: z.number().int().positive(),
  positions: z.array(AgentPositionSchema),
  consensus: z.object({
    reached: z.boolean(),
    recommendation: z.string(),
    dissent: z.array(z.string()),
    blockingObjections: z.array(z.string()),
  }),
  riskSummary: z.array(RiskFlagSchema),
  totalCostUsd: z.number(),
  completedAt: z.string().datetime(),
});
export type DeliberationReport = z.infer<typeof DeliberationReportSchema>;

// ── Phase F: Implementation & PR types ──────────────────────────────────────

export const ToolCallSchema = z.object({
  tool: z.string(),
  operation: z.string(),
  // All other fields are tool-specific
}).passthrough();
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ImplementationStepSchema = z.object({
  iteration: z.number().int(),
  narrative: z.string(),
  toolCalls: z.array(ToolCallSchema),
  toolResults: z.array(z.object({
    tool: z.string(),
    success: z.boolean(),
    output: z.unknown(),
    error: z.string().optional(),
  })),
});
export type ImplementationStep = z.infer<typeof ImplementationStepSchema>;

export const AgentResponseSchema = z.object({
  status: z.enum(['in_progress', 'complete', 'blocked']),
  narrative: z.string(),
  toolCalls: z.array(ToolCallSchema).default([]),
  prUrl: z.string().optional(),
  prNumber: z.number().optional(),
  filesModified: z.array(z.string()).optional(),
  blockingIssues: z.array(z.string()).optional(),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;

export const SecurityReviewSchema = z.object({
  approved: z.boolean(),
  findings: z.array(z.object({
    severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
    description: z.string(),
    file: z.string().optional(),
  })),
  blockingIssues: z.array(z.string()),
  recommendation: z.string(),
});
export type SecurityReview = z.infer<typeof SecurityReviewSchema>;

// ── Phase 3: Code review + test plan types ───────────────────────────────────

export const CodeReviewVerdictSchema = z.enum(['approve', 'request_changes', 'block']);
export type CodeReviewVerdict = z.infer<typeof CodeReviewVerdictSchema>;

export const CodeReviewResultSchema = z.object({
  verdict: CodeReviewVerdictSchema,
  rationale: z.string(),
  requiredFixes: z.array(z.string()),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  securityConcerns: z.array(z.string()),
  testingGaps: z.array(z.string()),
});
export type CodeReviewResult = z.infer<typeof CodeReviewResultSchema>;

export const TestPlanItemSchema = z.object({
  description: z.string(),
  type: z.enum(['unit', 'integration', 'e2e', 'manual']),
  priority: z.enum(['required_before_pr', 'recommended', 'not_applicable']),
});
export type TestPlanItem = z.infer<typeof TestPlanItemSchema>;

export const TestPlanResultSchema = z.object({
  requiredBeforePr: z.array(TestPlanItemSchema),
  recommended: z.array(TestPlanItemSchema),
  notApplicable: z.array(TestPlanItemSchema),
  summary: z.string(),
});
export type TestPlanResult = z.infer<typeof TestPlanResultSchema>;

export const PatchPreviewSchema = z.object({
  path: z.string(),
  originalSnippet: z.string(),
  proposedSnippet: z.string(),
  reason: z.string(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  reviewerVerdict: CodeReviewVerdictSchema.optional(),
});
export type PatchPreview = z.infer<typeof PatchPreviewSchema>;

// ── Phase 4: SafeTestRunner result types ─────────────────────────────────────

export const TestRunStatusSchema = z.enum(['passed', 'failed', 'timeout', 'tests_not_configured', 'blocked']);
export type TestRunStatus = z.infer<typeof TestRunStatusSchema>;

export const TestRunResultSchema = z.object({
  profile: z.enum(['unit', 'lint', 'typecheck', 'targeted']),
  status: TestRunStatusSchema,
  exitCode: z.number().nullable().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  durationMs: z.number(),
  truncated: z.boolean().optional(),
  label: z.string().optional(),
  error: z.string().optional(),
});
export type TestRunResult = z.infer<typeof TestRunResultSchema>;

export const PRQualityChecklistSchema = z.object({
  taskSummary: z.string(),
  filesChanged: z.array(z.string()),
  agentReasoning: z.string(),
  securityReviewPassed: z.boolean(),
  testPlanComplete: z.boolean(),
  humanApprovalsObtained: z.boolean(),
  auditChainValid: z.boolean(),
  codeReviewVerdict: CodeReviewVerdictSchema.optional(),
  testResults: z.array(TestRunResultSchema).optional(),
  requiredTestsPassed: z.boolean().optional(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  readyToMerge: z.boolean(),
});
export type PRQualityChecklist = z.infer<typeof PRQualityChecklistSchema>;

// ── Phase 5: Memory reference types ──────────────────────────────────────────

export const MemoryReferenceSchema = z.object({
  memoryId: z.string().uuid(),
  category: z.string(),
  title: z.string(),
  confidence: z.number().min(0).max(1),
  influence: z.enum(['applied', 'considered', 'rejected_as_outdated']),
});
export type MemoryReference = z.infer<typeof MemoryReferenceSchema>;

export const PRWorkflowReportSchema = z.object({
  projectId: z.string(),
  task: z.string(),
  implementationPlan: z.string(),
  steps: z.array(ImplementationStepSchema),
  prUrl: z.string().optional(),
  prNumber: z.number().optional(),
  branch: z.string().optional(),
  filesModified: z.array(z.string()),
  securityReview: SecurityReviewSchema.optional(),
  codeReview: CodeReviewResultSchema.optional(),
  testPlan: TestPlanResultSchema.optional(),
  testResults: z.array(TestRunResultSchema).optional(),
  patchPreviews: z.array(PatchPreviewSchema).optional(),
  checklist: PRQualityChecklistSchema.optional(),
  memoryReferences: z.array(MemoryReferenceSchema).optional(),
  blockingObjections: z.array(z.string()),
  totalCostUsd: z.number(),
  completedAt: z.string().datetime(),
});
export type PRWorkflowReport = z.infer<typeof PRWorkflowReportSchema>;

// ── Phase 6: Onboarding + metrics types ─────────────────────────────────────

export const OnboardingReportSchema = z.object({
  projectId: z.string(),
  repoFullName: z.string().optional(),
  packageManager: z.string(),
  isMonorepo: z.boolean(),
  frameworks: z.array(z.string()),
  testCommand: z.string().optional(),
  lintCommand: z.string().optional(),
  typecheckCommand: z.string().optional(),
  hasTypeScript: z.boolean(),
  hasCiConfig: z.boolean(),
  memoriesWritten: z.number().int(),
  permissionRulesCreated: z.number().int(),
  completedAt: z.string().datetime(),
});
export type OnboardingReport = z.infer<typeof OnboardingReportSchema>;

export const ApprovalMetricRowSchema = z.object({
  agentRole: z.string().optional(),
  toolName: z.string().optional(),
  approved: z.number().int(),
  denied: z.number().int(),
  autoAllowed: z.number().int(),
  total: z.number().int(),
  approvalRate: z.number(),
});
export type ApprovalMetricRow = z.infer<typeof ApprovalMetricRowSchema>;

export const ApprovalMetricsSchema = z.object({
  rows: z.array(ApprovalMetricRowSchema),
  globalApprovalRate: z.number(),
  totalDecisions: z.number().int(),
  highTrustAgents: z.array(z.string()),
});
export type ApprovalMetrics = z.infer<typeof ApprovalMetricsSchema>;

// ── Provider / model registries ─────────────────────────────────────────────

export type ProviderName = 'openai' | 'anthropic' | 'google';
export type TierName = 'fast' | 'standard' | 'premium';

export const MODEL_REGISTRY: Record<ProviderName, Record<TierName, string>> = {
  openai: { fast: 'gpt-4o-mini', standard: 'gpt-4o', premium: 'o1-preview' },
  anthropic: { fast: 'claude-haiku-4-5-20251001', standard: 'claude-sonnet-4-6', premium: 'claude-opus-4-8' },
  google: { fast: 'gemini-1.5-flash', standard: 'gemini-1.5-pro', premium: 'gemini-2.0-flash-exp' },
};

export const COST_REGISTRY: Record<ProviderName, Record<TierName, { inputPer1k: number; outputPer1k: number }>> = {
  openai: {
    fast:     { inputPer1k: 0.00015, outputPer1k: 0.0006 },
    standard: { inputPer1k: 0.005,   outputPer1k: 0.015  },
    premium:  { inputPer1k: 0.015,   outputPer1k: 0.06   },
  },
  anthropic: {
    fast:     { inputPer1k: 0.00025, outputPer1k: 0.00125 },
    standard: { inputPer1k: 0.003,   outputPer1k: 0.015   },
    premium:  { inputPer1k: 0.015,   outputPer1k: 0.075   },
  },
  google: {
    fast:     { inputPer1k: 0.000075, outputPer1k: 0.0003 },
    standard: { inputPer1k: 0.00125,  outputPer1k: 0.005  },
    premium:  { inputPer1k: 0.002,    outputPer1k: 0.006  },
  },
};

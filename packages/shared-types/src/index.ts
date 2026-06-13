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

import type {
  AgentRole, AgentProposal, AgentCritique, Vote,
  DeliberationReport, AgentPosition, RiskFlag, ProviderName
} from '@consensus/shared-types';
import type { RoundResult } from './debate-engine.js';

export interface SynthesisInput {
  deliberationId: string;
  task: string;
  roundResults: RoundResult[];
  totalCostUsd: number;
  agentProviders: Map<AgentRole, ProviderName>;
}

export class SynthesisEngine {
  synthesize(input: SynthesisInput): DeliberationReport {
    const { deliberationId, task, roundResults, totalCostUsd, agentProviders } = input;

    if (roundResults.length === 0) throw new Error('No round results to synthesize');

    const lastRound = roundResults[roundResults.length - 1];
    const positions: AgentPosition[] = [];
    const allBlockingObjections: string[] = [];
    const allRiskFlags: RiskFlag[] = [];

    for (const [role, proposal] of lastRound.proposals) {
      const critiquesForAgent: AgentCritique[] = [];
      for (const [, agentCritiques] of lastRound.critiques) {
        critiquesForAgent.push(...agentCritiques.filter(c => c.targetAgentRole === role));
      }

      const riskFlags: RiskFlag[] = proposal.risks.map(r => ({
        severity: 'medium' as const,
        description: r,
        raisedBy: role,
      }));

      const blockingCritiques = critiquesForAgent.filter(c => c.isBlocking);
      for (const bc of blockingCritiques) {
        allBlockingObjections.push(...bc.objections);
      }

      allRiskFlags.push(...riskFlags);

      positions.push({
        agentRole: role,
        provider: agentProviders.get(role) ?? 'unknown',
        proposal,
        critiques: critiquesForAgent,
        finalVote: lastRound.votes.get(role),
        riskFlags,
      });
    }

    const votes = [...lastRound.votes.values()];
    const acceptVotes = votes.filter(v => v.vote === 'accept').length;
    const consensusReached = acceptVotes === votes.length;

    // Synthesize recommendation from all proposals
    const recommendations = [...lastRound.proposals.values()].map(p => p.recommendation);
    const synthesizedRecommendation = recommendations.join(' | ');

    const dissent = votes
      .filter(v => v.vote === 'reject')
      .map(v => v.rationale);

    return {
      deliberationId,
      task,
      rounds: roundResults.length,
      positions,
      consensus: {
        reached: consensusReached,
        recommendation: synthesizedRecommendation,
        dissent,
        blockingObjections: allBlockingObjections,
      },
      riskSummary: allRiskFlags,
      totalCostUsd,
      completedAt: new Date().toISOString(),
    };
  }
}

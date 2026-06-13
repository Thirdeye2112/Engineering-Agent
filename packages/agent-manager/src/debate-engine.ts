import { Agent } from './agent.js';
import type { IAIProvider } from './provider-interface.js';
import type { AgentRole, AgentProposal, AgentCritique, Vote, DeliberationReport, RiskFlag } from '@consensus/shared-types';
import { SynthesisEngine } from './synthesis-engine.js';

export interface AgentInputConfig {
  provider: IAIProvider;
  role: AgentRole;
}

export interface RoundResult {
  round: number;
  proposals: Map<AgentRole, AgentProposal>;
  critiques: Map<AgentRole, AgentCritique[]>;
  votes: Map<AgentRole, Vote>;
}

export interface DebateConfig {
  deliberationId: string;
  task: string;
  agents: AgentInputConfig[];
  maxRounds: number;
  budgetCap?: number;
  onEvent?: (event: DebateEvent) => void;
}

export type DebateEvent =
  | { type: 'round_started'; round: number }
  | { type: 'agent_thinking'; role: AgentRole; phase: string }
  | { type: 'agent_position_ready'; role: AgentRole; proposal: AgentProposal }
  | { type: 'round_complete'; round: number; results: RoundResult }
  | { type: 'synthesis_started' }
  | { type: 'deliberation_complete'; report: DeliberationReport };

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a.join(' ').toLowerCase().split(/\s+/));
  const setB = new Set(b.join(' ').toLowerCase().split(/\s+/));
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
}

export class DebateEngine {
  private agents: Map<AgentRole, Agent> = new Map();
  private roundResults: RoundResult[] = [];
  private totalCostUsd = 0;

  constructor(private config: DebateConfig) {}

  async run(): Promise<DeliberationReport> {
    // Init agents
    for (const agentConfig of this.config.agents) {
      const agent = new Agent({
        provider: agentConfig.provider,
        role: agentConfig.role,
        deliberationId: this.config.deliberationId,
        task: this.config.task,
      });
      await agent.init();
      this.agents.set(agentConfig.role, agent);
    }

    let previousRecommendations: string[] = [];
    let previousCritiques = new Map<AgentRole, AgentCritique[]>();
    let previousProposals = new Map<AgentRole, AgentProposal>();

    for (let round = 1; round <= this.config.maxRounds; round++) {
      this.config.onEvent?.({ type: 'round_started', round });

      const proposals = new Map<AgentRole, AgentProposal>();
      const critiques = new Map<AgentRole, AgentCritique[]>();
      const votes = new Map<AgentRole, Vote>();

      // Propose/revise phase
      for (const [role, agent] of this.agents) {
        this.config.onEvent?.({ type: 'agent_thinking', role, phase: 'propose' });
        let proposal: AgentProposal;
        if (round === 1) {
          proposal = await agent.propose();
        } else {
          // Revise based on critiques received in the prior round
          const receivedCritiques = [...previousCritiques.entries()]
            .filter(([r]) => r !== role)
            .map(([r, crits]) => ({ role: r, critique: crits.find(c => c.targetAgentRole === role) }))
            .filter(x => x.critique !== undefined);
          const prior = previousProposals.get(role)!;
          proposal = await agent.revise(prior, receivedCritiques as Array<{ role: string; critique: AgentCritique }>);
        }
        proposals.set(role, proposal);
        this.config.onEvent?.({ type: 'agent_position_ready', role, proposal });

        // Budget check
        this.totalCostUsd += agent.costUsd;
        if (this.config.budgetCap && this.totalCostUsd >= this.config.budgetCap) break;
      }

      // Critique phase
      for (const [role, agent] of this.agents) {
        const agentCritiques: AgentCritique[] = [];
        for (const [peerRole, peerProposal] of proposals) {
          if (peerRole === role) continue;
          this.config.onEvent?.({ type: 'agent_thinking', role, phase: 'critique' });
          const critique = await agent.critique(peerRole, peerProposal);
          agentCritiques.push(critique);
        }
        critiques.set(role, agentCritiques);
      }

      // Vote phase
      const proposalList = [...proposals.entries()].map(([r, p]) => ({ role: r, proposal: p }));
      for (const [role, agent] of this.agents) {
        this.config.onEvent?.({ type: 'agent_thinking', role, phase: 'vote' });
        const vote = await agent.vote(proposalList);
        votes.set(role, vote);
      }

      const result: RoundResult = { round, proposals, critiques, votes };
      this.roundResults.push(result);
      previousProposals = proposals;
      previousCritiques = critiques;
      this.config.onEvent?.({ type: 'round_complete', round, results: result });

      // Deadlock detection via Jaccard similarity
      const recommendations = [...proposals.values()].map(p => p.recommendation);
      if (round > 1 && jaccardSimilarity(previousRecommendations, recommendations) > 0.85) {
        break; // Positions have converged
      }
      previousRecommendations = recommendations;

      // Early exit if all accept
      const allAccept = [...votes.values()].every(v => v.vote === 'accept');
      if (allAccept) break;
    }

    this.config.onEvent?.({ type: 'synthesis_started' });

    const synthesis = new SynthesisEngine();
    const report = synthesis.synthesize({
      deliberationId: this.config.deliberationId,
      task: this.config.task,
      roundResults: this.roundResults,
      totalCostUsd: this.totalCostUsd,
      agentProviders: new Map([...this.agents.entries()].map(([r, a]) => [r, (a as any)['config'].provider.provider])),
    });

    this.config.onEvent?.({ type: 'deliberation_complete', report });
    return report;
  }
}

import { Agent } from './agent.js';
import type { IAIProvider } from './provider-interface.js';
import type { AgentRole, Subtask, SubtaskResult, AgentProposal } from '@consensus/shared-types';

export class SubtaskExecutor {
  constructor(
    private subtask: Subtask,
    private provider: IAIProvider,
    private projectId: string,
  ) {}

  async execute(): Promise<SubtaskResult> {
    const agent = new Agent({
      provider: this.provider,
      role: this.subtask.assignedRole,
      deliberationId: `${this.projectId}:${this.subtask.id}`,
      task: this.subtask.description,
    });
    await agent.init();

    const proposal = await agent.propose();
    const deliverable = `${proposal.recommendation}\n\n${proposal.reasoning.join('\n')}`;

    return {
      subtaskId: this.subtask.id,
      agentRole: this.subtask.assignedRole,
      deliverable,
      concerns: proposal.risks,
      completedAt: new Date().toISOString(),
    };
  }

  async crossReview(peerDeliverable: string, peerRole: AgentRole): Promise<string[]> {
    const peerProposal: AgentProposal = {
      recommendation: peerDeliverable,
      reasoning: [peerDeliverable],
      assumptions: [],
      risks: [],
      confidence: 0.8,
    };

    const agent = new Agent({
      provider: this.provider,
      role: this.subtask.assignedRole,
      deliberationId: `${this.projectId}:review:${this.subtask.id}`,
      task: `Cross-review: ${this.subtask.description}`,
    });
    await agent.init();

    const critique = await agent.critique(peerRole, peerProposal);
    return critique.objections;
  }
}

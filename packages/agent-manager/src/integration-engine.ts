import { Agent } from './agent.js';
import type { IAIProvider } from './provider-interface.js';
import type { SubtaskResult } from '@consensus/shared-types';

export class IntegrationEngine {
  constructor(private provider: IAIProvider, private projectId: string) {}

  async integrate(task: string, results: SubtaskResult[]): Promise<string> {
    const agent = new Agent({
      provider: this.provider,
      role: 'integrator',
      deliberationId: `${this.projectId}:integration`,
      task,
    });
    await agent.init();

    // Build a structured deliverables summary to inject as context
    const deliverablesSummary = results.map(r =>
      `### ${r.agentRole} (${r.subtaskId})\n${r.deliverable}\n\nConcerns:\n${r.concerns.map(c => `- ${c}`).join('\n')}`
    ).join('\n\n---\n\n');

    // Use a raw call via propose() won't work here — we need a custom integration
    // prompt. We inject the deliverables into the task context.
    const integrationAgent = new Agent({
      provider: this.provider,
      role: 'integrator',
      deliberationId: `${this.projectId}:integration`,
      task: `${task}\n\n## Agent deliverables to integrate:\n\n${deliverablesSummary}`,
    });
    await integrationAgent.init();

    const proposal = await integrationAgent.propose();
    return [
      proposal.recommendation,
      '',
      '## Reasoning',
      ...proposal.reasoning.map(r => `- ${r}`),
      '',
      '## Assumptions',
      ...proposal.assumptions.map(a => `- ${a}`),
      '',
      '## Risks',
      ...proposal.risks.map(r => `- ${r}`),
    ].join('\n');
  }
}

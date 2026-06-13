import type { IAIProvider } from './provider-interface.js';
import type { SubtaskResult } from '@consensus/shared-types';

export class IntegrationEngine {
  constructor(private provider: IAIProvider) {}

  async integrate(task: string, results: SubtaskResult[]): Promise<string> {
    const deliverables = results.map(r =>
      `## ${r.agentRole} (subtask ${r.subtaskId})\n${r.deliverable}\n\nConcerns:\n${r.concerns.map(c => `- ${c}`).join('\n')}`
    ).join('\n\n---\n\n');

    const resp = await this.provider.sendMessage({
      messages: [
        {
          role: 'system',
          content: 'You are an integration specialist. Synthesize all agent deliverables into a single, coherent document. Preserve all findings and concerns. Do not suppress minority opinions.',
        },
        {
          role: 'user',
          content: `Task: ${task}\n\nAgent deliverables:\n\n${deliverables}\n\nProduce an integrated document.`,
        },
      ],
    });

    return resp.content;
  }
}

import type { Subtask, SubtaskResult, AgentRole } from '@consensus/shared-types';
import type { IAIProvider } from './provider-interface.js';
import { SubtaskExecutor } from './subtask-executor.js';

export class CollaborationOrchestrator {
  constructor(
    private projectId: string,
    private provider: IAIProvider,
  ) {}

  async run(subtasks: Subtask[]): Promise<SubtaskResult[]> {
    const results: SubtaskResult[] = [];
    const maxWave = Math.max(...subtasks.map(s => s.wave));

    for (let wave = 0; wave <= maxWave; wave++) {
      const waveSubtasks = subtasks.filter(s => s.wave === wave);
      const waveResults = await Promise.all(
        waveSubtasks.map(s => new SubtaskExecutor(s, this.provider, this.projectId).execute()),
      );
      results.push(...waveResults);
    }

    // Cross-review: each agent reviews peers' deliverables from its domain lens
    const crossReviewConcerns = new Map<string, string[]>();
    for (const result of results) {
      const peers = results.filter(r => r.subtaskId !== result.subtaskId);
      const executor = new SubtaskExecutor(
        subtasks.find(s => s.id === result.subtaskId)!,
        this.provider,
        this.projectId,
      );
      for (const peer of peers) {
        const concerns = await executor.crossReview(peer.deliverable, peer.agentRole as AgentRole);
        if (concerns.length > 0) {
          const key = peer.subtaskId;
          crossReviewConcerns.set(key, [...(crossReviewConcerns.get(key) ?? []), ...concerns]);
        }
      }
    }

    // Merge cross-review concerns back into results
    return results.map(r => ({
      ...r,
      concerns: [...r.concerns, ...(crossReviewConcerns.get(r.subtaskId) ?? [])],
    }));
  }
}

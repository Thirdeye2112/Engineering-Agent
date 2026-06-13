import type { Subtask, SubtaskResult } from '@consensus/shared-types';
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

    return results;
  }
}

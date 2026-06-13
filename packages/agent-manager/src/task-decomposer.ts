import type { IAIProvider } from './provider-interface.js';
import type { AgentRole, Subtask } from '@consensus/shared-types';
import { bestFitRole } from '@consensus/shared-types';

export class TaskDecomposer {
  constructor(private provider: IAIProvider) {}

  async decompose(task: string, availableRoles: AgentRole[]): Promise<Subtask[]> {
    const resp = await this.provider.sendMessage({
      messages: [
        {
          role: 'system',
          content: `You are a task decomposer. Break the given task into 3-6 subtasks that can be assigned to specialized agents. 
Respond with ONLY a JSON array:
[{
  "id": "subtask-1",
  "description": "string",
  "dependencies": [],
  "wave": 0
}]
wave 0 = no dependencies, wave N = depends on wave N-1 tasks.`,
        },
        { role: 'user', content: `Decompose this task: ${task}` },
      ],
    });

    let subtasks: Array<{ id: string; description: string; dependencies: string[]; wave: number }>;
    try {
      const cleaned = resp.content.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
      subtasks = JSON.parse(cleaned);
    } catch {
      // Fallback: single subtask
      subtasks = [{ id: 'subtask-1', description: task, dependencies: [], wave: 0 }];
    }

    return subtasks.map(s => ({
      ...s,
      assignedRole: bestFitRole(s.description, availableRoles),
    }));
  }
}

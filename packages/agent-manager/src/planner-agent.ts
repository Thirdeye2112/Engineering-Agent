import type { IAIProvider } from './provider-interface.js';
import { withRetry } from './batch-retry.js';

const SYSTEM_PROMPT = `You are a software engineering planner. Your job is to analyze a codebase and propose the most valuable next tasks to improve it.

Given a description of the codebase and its current state, produce exactly 3 candidate tasks ranked by value.

Respond ONLY with valid JSON:
{
  "tasks": [
    {
      "id": "short-kebab-id",
      "title": "Short title (5-8 words)",
      "description": "What to build and why (2-3 sentences)",
      "rationale": "Why this task is valuable right now (1 sentence)",
      "expectedFiles": ["path/to/file.ts"],
      "priority": "high" | "medium" | "low",
      "estimatedComplexity": "small" | "medium" | "large"
    }
  ],
  "repoSummary": "One sentence summary of the repo's current state"
}

Rules:
- Prefer small, concrete, testable tasks over large refactors
- Each task must be completable in a single PR
- Do not propose tasks that require external accounts or credentials
- Focus on what would make the codebase more useful, reliable, or complete`;

export interface PlannedTask {
  id: string;
  title: string;
  description: string;
  rationale: string;
  expectedFiles: string[];
  priority: 'high' | 'medium' | 'low';
  estimatedComplexity: 'small' | 'medium' | 'large';
}

export interface PlannerResult {
  tasks: PlannedTask[];
  repoSummary: string;
}

export class PlannerAgent {
  constructor(private provider: IAIProvider) {}

  async plan(context: {
    repoDescription: string;
    recentPRs?: string[];
    failedTasks?: string[];
    completedTasks?: string[];
  }): Promise<PlannerResult> {
    const sections = [
      `Repository: ${context.repoDescription}`,
      context.completedTasks?.length
        ? `Recently completed: ${context.completedTasks.join(', ')}`
        : '',
      context.failedTasks?.length
        ? `Recently failed (avoid repeating): ${context.failedTasks.join(', ')}`
        : '',
      context.recentPRs?.length
        ? `Recent PRs: ${context.recentPRs.join(', ')}`
        : '',
    ].filter(Boolean).join('\n');

    const resp = await withRetry(() =>
      this.provider.sendMessage({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Analyze this codebase and propose the 3 most valuable next tasks:\n\n${sections}` },
        ],
        maxTokens: 1024,
      }),
    );

    return this.parse(resp.content);
  }

  private parse(raw: string): PlannerResult {
    let cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    const start = cleaned.indexOf('{');
    if (start > 0) cleaned = cleaned.slice(start);
    try {
      const parsed = JSON.parse(cleaned) as PlannerResult;
      if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
        throw new Error('No tasks in planner response');
      }
      return parsed;
    } catch {
      return {
        tasks: [{
          id: 'improve-test-coverage',
          title: 'Add missing unit tests',
          description: 'Add unit tests for untested utility functions to improve reliability.',
          rationale: 'Test coverage is a quick, high-value improvement.',
          expectedFiles: ['src/**/*.test.ts'],
          priority: 'medium',
          estimatedComplexity: 'small',
        }],
        repoSummary: 'Codebase needs improvement (planner response unparseable).',
      };
    }
  }
}

import type { IAIProvider } from './provider-interface.js';
import { withRetry } from './batch-retry.js';

const SYSTEM_PROMPT = `You are a software engineering planner. Analyze the codebase description and respond with ONLY a JSON object — no explanation, no markdown, no prose before or after.

Required JSON format (copy exactly, fill in values):
{"tasks":[{"id":"kebab-id","title":"Short title","description":"What to build","rationale":"Why now","expectedFiles":["src/file.ts"],"priority":"high","estimatedComplexity":"small"},{"id":"kebab-id-2","title":"Short title 2","description":"What to build","rationale":"Why now","expectedFiles":["src/file2.ts"],"priority":"medium","estimatedComplexity":"small"},{"id":"kebab-id-3","title":"Short title 3","description":"What to build","rationale":"Why now","expectedFiles":["src/file3.ts"],"priority":"low","estimatedComplexity":"small"}],"repoSummary":"One sentence about the repo."}

Rules:
- priority must be exactly "high", "medium", or "low"
- estimatedComplexity must be exactly "small", "medium", or "large"
- Each task must be completable in one PR
- Prefer concrete, testable improvements over large refactors
- Your entire response must be valid JSON and nothing else`;

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
        maxTokens: 2048,
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

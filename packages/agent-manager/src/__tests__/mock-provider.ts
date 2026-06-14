/**
 * Mock AI provider for testing — returns canned responses without API calls.
 */
import type { IAIProvider, SendMessageRequest, SendMessageResponse } from '../provider-interface.js';
import type { ProviderName, TierName } from '@consensus/shared-types';

export class MockProvider implements IAIProvider {
  readonly provider: ProviderName = 'anthropic';
  readonly tier: TierName = 'standard';
  readonly model: string = 'mock-model';
  private responses: string[];
  private callCount = 0;

  constructor(responses: string | string[]) {
    this.responses = Array.isArray(responses) ? responses : [responses];
  }

  isAvailable() { return true; }
  estimateCost() { return 0; }
  getCapabilities() { return { maxContextTokens: 200000, supportsStreaming: false, supportsVision: false }; }

  async sendMessage(_req: SendMessageRequest): Promise<SendMessageResponse> {
    const content = this.responses[this.callCount % this.responses.length];
    this.callCount++;
    return { content, inputTokens: 10, outputTokens: 10, costUsd: 0 };
  }

  get calls() { return this.callCount; }
}

export const PLANNER_RESPONSE = JSON.stringify({
  tasks: [
    {
      id: 'add-input-validation',
      title: 'Add input validation to API handlers',
      description: 'Add Zod validation to all API handler inputs to reject malformed requests early.',
      rationale: 'Prevents runtime errors from bad input and improves security posture.',
      expectedFiles: ['src/handlers/index.ts'],
      priority: 'high',
      estimatedComplexity: 'small',
    },
    {
      id: 'improve-error-messages',
      title: 'Improve error message clarity',
      description: 'Replace generic error strings with structured error objects that include context.',
      rationale: 'Better errors reduce debugging time significantly.',
      expectedFiles: ['src/errors.ts'],
      priority: 'medium',
      estimatedComplexity: 'small',
    },
    {
      id: 'add-health-endpoint',
      title: 'Add /healthz endpoint',
      description: 'Add a simple health check endpoint that verifies DB connectivity.',
      rationale: 'Required for production monitoring and load balancer checks.',
      expectedFiles: ['src/routes/health.ts'],
      priority: 'medium',
      estimatedComplexity: 'small',
    },
  ],
  repoSummary: 'TypeScript API server with missing input validation and monitoring endpoints.',
});

export const DEBATE_RESPONSE = JSON.stringify({
  recommendation: 'Add input validation to API handlers (add-input-validation) — highest impact, smallest scope.',
  confidence: 0.9,
  dissent: [],
});

export const IMPLEMENTATION_RESPONSE = JSON.stringify({
  status: 'complete',
  narrative: 'Added Zod validation to all handlers.',
  toolCalls: [],
  prUrl: 'https://github.com/test/repo/pull/42',
  prNumber: 42,
  filesModified: ['src/handlers/index.ts'],
});

export const PROPOSAL_RESPONSE = JSON.stringify({
  recommendation: DEBATE_RESPONSE,
  confidence: 0.85,
  risks: [],
  openQuestions: [],
});

export const CRITIQUE_RESPONSE = JSON.stringify({
  agrees: true,
  concerns: [],
  suggestions: [],
  revisedRecommendation: null,
});

export const VOTE_RESPONSE = JSON.stringify({
  winner: 0,
  rationale: 'Option 1 has highest value.',
  confidence: 0.9,
});

export const SYNTHESIS_RESPONSE = JSON.stringify({
  recommendation: 'Implement add-input-validation first.',
  confidence: 0.9,
  dissent: [],
  riskFlags: [],
});

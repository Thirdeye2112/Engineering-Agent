import Anthropic from '@anthropic-ai/sdk';
import type { IAIProvider, SendMessageRequest, SendMessageResponse } from '../provider-interface.js';
import { MODEL_REGISTRY, COST_REGISTRY } from '@consensus/shared-types';
import type { ProviderName, TierName } from '@consensus/shared-types';
import { withRetry } from '../batch-retry.js';

export class AnthropicProvider implements IAIProvider {
  readonly provider: ProviderName = 'anthropic';
  readonly tier: TierName;
  readonly model: string;
  private client: Anthropic;

  constructor(tier: TierName) {
    this.tier = tier;
    this.model = MODEL_REGISTRY.anthropic[tier];
    // Support Replit AI integration env vars as fallback to manual API key
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
    const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
    this.client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }

  isAvailable(): boolean {
    return !!(process.env.ANTHROPIC_API_KEY ?? process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY);
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    const costs = COST_REGISTRY.anthropic[this.tier];
    return (inputTokens / 1000) * costs.inputPer1k + (outputTokens / 1000) * costs.outputPer1k;
  }

  getCapabilities() {
    return { maxContextTokens: 200000, supportsStreaming: true, supportsVision: true };
  }

  async sendMessage(req: SendMessageRequest): Promise<SendMessageResponse> {
    const systemMsg = req.messages.find(m => m.role === 'system');
    const nonSystemMessages = req.messages.filter(m => m.role !== 'system');

    const resp = await withRetry(() => this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 4096,
      system: systemMsg?.content,
      messages: nonSystemMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    }));

    const content = resp.content.filter(b => b.type === 'text').map(b => (b as any).text).join('');
    const inputTokens = resp.usage.input_tokens;
    const outputTokens = resp.usage.output_tokens;
    return { content, inputTokens, outputTokens, costUsd: this.estimateCost(inputTokens, outputTokens) };
  }
}

import OpenAI from 'openai';
import type { IAIProvider, SendMessageRequest, SendMessageResponse } from '../provider-interface.js';
import { MODEL_REGISTRY, COST_REGISTRY } from '@consensus/shared-types';
import type { ProviderName, TierName } from '@consensus/shared-types';

export class OpenAIProvider implements IAIProvider {
  readonly provider: ProviderName = 'openai';
  readonly tier: TierName;
  readonly model: string;
  private client: OpenAI;

  constructor(tier: TierName) {
    this.tier = tier;
    this.model = MODEL_REGISTRY.openai[tier];
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  isAvailable(): boolean { return !!process.env.OPENAI_API_KEY; }

  estimateCost(inputTokens: number, outputTokens: number): number {
    const costs = COST_REGISTRY.openai[this.tier];
    return (inputTokens / 1000) * costs.inputPer1k + (outputTokens / 1000) * costs.outputPer1k;
  }

  getCapabilities() {
    return { maxContextTokens: 128000, supportsStreaming: true, supportsVision: this.tier !== 'fast' };
  }

  async sendMessage(req: SendMessageRequest): Promise<SendMessageResponse> {
    const messages = req.messages.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));
    const resp = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
    });
    const content = resp.choices[0]?.message?.content ?? '';
    const inputTokens = resp.usage?.prompt_tokens ?? 0;
    const outputTokens = resp.usage?.completion_tokens ?? 0;
    return { content, inputTokens, outputTokens, costUsd: this.estimateCost(inputTokens, outputTokens) };
  }
}

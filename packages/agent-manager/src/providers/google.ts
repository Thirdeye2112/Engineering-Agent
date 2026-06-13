import { GoogleGenerativeAI } from '@google/generative-ai';
import type { IAIProvider, SendMessageRequest, SendMessageResponse } from '../provider-interface.js';
import { MODEL_REGISTRY, COST_REGISTRY } from '@consensus/shared-types';
import type { ProviderName, TierName } from '@consensus/shared-types';

export class GoogleProvider implements IAIProvider {
  readonly provider: ProviderName = 'google';
  readonly tier: TierName;
  readonly model: string;
  private genAI: GoogleGenerativeAI;

  constructor(tier: TierName) {
    this.tier = tier;
    this.model = MODEL_REGISTRY.google[tier];
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? '';
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  isAvailable(): boolean {
    return !!(process.env.GOOGLE_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY);
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    const costs = COST_REGISTRY.google[this.tier];
    return (inputTokens / 1000) * costs.inputPer1k + (outputTokens / 1000) * costs.outputPer1k;
  }

  getCapabilities() {
    return { maxContextTokens: 1000000, supportsStreaming: true, supportsVision: true };
  }

  async sendMessage(req: SendMessageRequest): Promise<SendMessageResponse> {
    const model = this.genAI.getGenerativeModel({ model: this.model });
    const systemMsg = req.messages.find(m => m.role === 'system');
    const chatMessages = req.messages.filter(m => m.role !== 'system');

    const history = chatMessages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const lastMsg = chatMessages[chatMessages.length - 1]?.content ?? '';

    const chat = model.startChat({
      history,
      systemInstruction: systemMsg?.content,
    });

    const result = await chat.sendMessage(lastMsg);
    const content = result.response.text();
    const usage = result.response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;
    return { content, inputTokens, outputTokens, costUsd: this.estimateCost(inputTokens, outputTokens) };
  }
}

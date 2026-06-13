import type { AgentRole, ProviderName, TierName } from '@consensus/shared-types';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SendMessageRequest {
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
}

export interface SendMessageResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface IAIProvider {
  readonly provider: ProviderName;
  readonly tier: TierName;
  readonly model: string;

  sendMessage(req: SendMessageRequest): Promise<SendMessageResponse>;
  isAvailable(): boolean;
  estimateCost(inputTokens: number, outputTokens: number): number;
  getCapabilities(): { maxContextTokens: number; supportsStreaming: boolean; supportsVision: boolean };
}

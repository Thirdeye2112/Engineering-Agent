import type { IAIProvider } from './provider-interface.js';
import type { ProviderName, TierName } from '@consensus/shared-types';
import { OpenAIProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GoogleProvider } from './providers/google.js';

export function createProvider(provider: ProviderName, tier: TierName): IAIProvider {
  switch (provider) {
    case 'openai':    return new OpenAIProvider(tier);
    case 'anthropic': return new AnthropicProvider(tier);
    case 'google':    return new GoogleProvider(tier);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

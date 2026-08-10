import { describe, expect, it } from 'vitest';
import { asLanguageModelUsage } from '../../../ai/src/types/usage';
import { convertOpenAICompatibleChatUsage } from './convert-openai-compatible-chat-usage';

describe('Fieldwork: inconsistent provider usage normalization', () => {
  it('keeps public totals internally consistent when reasoning exceeds completion', () => {
    const providerUsage = {
      prompt_tokens: 951,
      completion_tokens: 6000,
      total_tokens: 6952,
      prompt_tokens_details: { cached_tokens: 60 },
      completion_tokens_details: { reasoning_tokens: 6001 },
    };

    const internalUsage = convertOpenAICompatibleChatUsage(providerUsage);
    const publicUsage = asLanguageModelUsage(internalUsage);

    expect(internalUsage.outputTokens.text).toBeGreaterThanOrEqual(0);
    expect(internalUsage.outputTokens.total).toBeGreaterThanOrEqual(
      internalUsage.outputTokens.reasoning ?? 0,
    );
    expect(publicUsage.totalTokens).toBe(providerUsage.total_tokens);
  });
});

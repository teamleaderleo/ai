import { describe, expect, it } from 'vitest';
import { convertOpenAICompatibleChatUsage } from './convert-openai-compatible-chat-usage';

const providerUsage = {
  prompt_tokens: 951,
  completion_tokens: 6000,
  total_tokens: 6952,
  prompt_tokens_details: { cached_tokens: 60 },
  completion_tokens_details: { reasoning_tokens: 6001 },
};

describe('Fieldwork: inconsistent provider usage normalization', () => {
  it('keeps output total at least as large as its reasoning component', () => {
    const usage = convertOpenAICompatibleChatUsage(providerUsage);

    expect(usage.outputTokens.text).toBeGreaterThanOrEqual(0);
    expect(usage.outputTokens.total).toBeGreaterThanOrEqual(
      usage.outputTokens.reasoning ?? 0,
    );
  });

  it('keeps normalized input plus output aligned with the provider total', () => {
    const usage = convertOpenAICompatibleChatUsage(providerUsage);
    const normalizedTotal =
      (usage.inputTokens.total ?? 0) + (usage.outputTokens.total ?? 0);

    expect(normalizedTotal).toBe(providerUsage.total_tokens);
  });
});

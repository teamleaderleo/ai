import { createNullLanguageModelUsage } from '@ai-sdk/provider-utils';
import { describe, expect, it } from 'vitest';
import { convertTogetherAIChatUsage } from './convert-togetherai-chat-usage';

describe('convertTogetherAIChatUsage', () => {
  it('returns null usage when usage is missing', () => {
    expect(convertTogetherAIChatUsage(undefined)).toEqual(
      createNullLanguageModelUsage(),
    );
  });

  it('uses top-level reasoning tokens as TogetherAI completion detail', () => {
    const usage = {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      reasoning_tokens: 8,
    };

    expect(convertTogetherAIChatUsage(usage)).toEqual({
      inputTokens: {
        total: 10,
        noCache: 10,
        cacheRead: 0,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: 20,
        text: 12,
        reasoning: 8,
      },
      raw: usage,
    });
  });

  it('prefers OpenAI-style nested reasoning detail when present', () => {
    const usage = {
      prompt_tokens: 10,
      completion_tokens: 20,
      reasoning_tokens: 8,
      completion_tokens_details: { reasoning_tokens: 5 },
    };

    expect(convertTogetherAIChatUsage(usage).outputTokens).toEqual({
      total: 20,
      text: 15,
      reasoning: 5,
    });
  });

  it('preserves ordinary completion accounting without reasoning', () => {
    expect(
      convertTogetherAIChatUsage({
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      }).outputTokens,
    ).toEqual({
      total: 20,
      text: 20,
      reasoning: 0,
    });
  });
});

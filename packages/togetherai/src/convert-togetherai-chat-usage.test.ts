import { createNullLanguageModelUsage } from '@ai-sdk/provider-utils';
import { describe, expect, it } from 'vitest';
import { convertTogetherAIChatUsage } from './convert-togetherai-chat-usage';

describe('convertTogetherAIChatUsage', () => {
  it('returns null usage when usage is missing', () => {
    expect(convertTogetherAIChatUsage(undefined)).toEqual(
      createNullLanguageModelUsage(),
    );
  });

  it('uses flat cached tokens when nested details are absent', () => {
    const usage = {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      cached_tokens: 4,
    };

    expect(convertTogetherAIChatUsage(usage)).toEqual({
      inputTokens: {
        total: 10,
        noCache: 6,
        cacheRead: 4,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: 5,
        text: 5,
        reasoning: 0,
      },
      raw: usage,
    });
  });

  it('uses a nonzero nested cache count before the flat location', () => {
    const usage = {
      prompt_tokens: 10,
      completion_tokens: 5,
      cached_tokens: 4,
      prompt_tokens_details: { cached_tokens: 3 },
    };

    expect(convertTogetherAIChatUsage(usage).inputTokens).toEqual({
      total: 10,
      noCache: 7,
      cacheRead: 3,
      cacheWrite: undefined,
    });
  });

  it('falls back to flat cache count when nested count is zero', () => {
    const usage = {
      prompt_tokens: 10,
      completion_tokens: 5,
      cached_tokens: 4,
      prompt_tokens_details: { cached_tokens: 0 },
    };

    expect(convertTogetherAIChatUsage(usage).inputTokens).toEqual({
      total: 10,
      noCache: 6,
      cacheRead: 4,
      cacheWrite: undefined,
    });
  });

  it('preserves nested reasoning accounting', () => {
    expect(
      convertTogetherAIChatUsage({
        prompt_tokens: 10,
        completion_tokens: 20,
        completion_tokens_details: { reasoning_tokens: 5 },
      }).outputTokens,
    ).toEqual({
      total: 20,
      text: 15,
      reasoning: 5,
    });
  });
});

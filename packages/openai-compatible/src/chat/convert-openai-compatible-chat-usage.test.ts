import { createNullLanguageModelUsage } from '@ai-sdk/provider-utils';
import { describe, expect, it } from 'vitest';
import { convertOpenAICompatibleChatUsage } from './convert-openai-compatible-chat-usage';

describe('convertOpenAICompatibleChatUsage', () => {
  it('returns null usage when usage is missing', () => {
    expect(convertOpenAICompatibleChatUsage(undefined)).toEqual(
      createNullLanguageModelUsage(),
    );
  });

  it('preserves ordinary OpenAI-style completion accounting', () => {
    const usage = {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      completion_tokens_details: { reasoning_tokens: 5 },
    };

    expect(convertOpenAICompatibleChatUsage(usage)).toEqual({
      inputTokens: {
        total: 10,
        noCache: 10,
        cacheRead: 0,
        cacheWrite: undefined,
      },
      outputTokens: { total: 20, text: 15, reasoning: 5 },
      raw: usage,
    });
  });

  it('uses detailed or all-in counts as a floor when completion undercounts output', () => {
    // Provider-inconsistent usage observed with Baseten Kimi-K3: the response
    // says reasoning alone exceeds completion, while total_tokens agrees with
    // prompt + reasoning.
    const usage = {
      prompt_tokens: 951,
      completion_tokens: 6000,
      total_tokens: 6952,
      prompt_tokens_details: { cached_tokens: 60 },
      completion_tokens_details: { reasoning_tokens: 6001 },
    };

    expect(convertOpenAICompatibleChatUsage(usage)).toEqual({
      inputTokens: {
        total: 951,
        noCache: 891,
        cacheRead: 60,
        cacheWrite: undefined,
      },
      outputTokens: { total: 6001, text: 0, reasoning: 6001 },
      raw: usage,
    });
  });

  it('does not lower a valid completion count when total_tokens undercounts it', () => {
    const usage = {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 25,
      completion_tokens_details: { reasoning_tokens: 5 },
    };

    expect(convertOpenAICompatibleChatUsage(usage).outputTokens).toEqual({
      total: 20,
      text: 15,
      reasoning: 5,
    });
  });

  it('can preserve unclassified output represented only by total_tokens', () => {
    // xAI-style accounting is handled by its provider-specific convertUsage,
    // but this control ensures the generic fallback does not publish an output
    // total below the all-in response count if a compatible backend reports the
    // same dialect.
    const usage = {
      prompt_tokens: 12,
      completion_tokens: 1,
      total_tokens: 241,
      completion_tokens_details: { reasoning_tokens: 228 },
    };

    expect(convertOpenAICompatibleChatUsage(usage).outputTokens).toEqual({
      total: 229,
      text: 0,
      reasoning: 228,
    });
  });

  it('ignores total_tokens for output reconciliation when prompt_tokens is missing', () => {
    const usage = {
      completion_tokens: 4,
      total_tokens: 104,
      completion_tokens_details: { reasoning_tokens: 5 },
    };

    expect(convertOpenAICompatibleChatUsage(usage).outputTokens).toEqual({
      total: 5,
      text: 0,
      reasoning: 5,
    });
  });

  it('falls back to completion and reasoning when total_tokens is absent', () => {
    const usage = {
      prompt_tokens: 10,
      completion_tokens: 4,
      completion_tokens_details: { reasoning_tokens: 5 },
    };

    expect(convertOpenAICompatibleChatUsage(usage).outputTokens).toEqual({
      total: 5,
      text: 0,
      reasoning: 5,
    });
  });
});

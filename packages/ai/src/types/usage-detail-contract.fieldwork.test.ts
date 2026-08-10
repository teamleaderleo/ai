import type { LanguageModelV4Usage } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import { addLanguageModelUsage, asLanguageModelUsage } from './usage';

const providerDialectUsage: LanguageModelV4Usage = {
  inputTokens: {
    total: 12,
    noCache: 12,
    cacheRead: 0,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 322,
    text: 0,
    reasoning: 320,
  },
};

describe('Fieldwork: aggregate usage can retain output not classified as text/reasoning', () => {
  it('keeps the normalized output aggregate authoritative when details are incomplete', () => {
    expect(asLanguageModelUsage(providerDialectUsage)).toMatchObject({
      inputTokens: 12,
      outputTokens: 322,
      outputTokenDetails: {
        textTokens: 0,
        reasoningTokens: 320,
      },
      totalTokens: 334,
    });
  });

  it('aggregates totals and detailed categories independently across calls', () => {
    const normalized = asLanguageModelUsage(providerDialectUsage);
    const combined = addLanguageModelUsage(normalized, normalized);

    expect(combined).toMatchObject({
      inputTokens: 24,
      outputTokens: 644,
      outputTokenDetails: {
        textTokens: 0,
        reasoningTokens: 640,
      },
      totalTokens: 668,
    });
  });
});

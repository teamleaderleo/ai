import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import { createTogetherAI } from './togetherai-provider';

const TEST_PROMPT: LanguageModelV4Prompt = [
  { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
];

describe('TogetherAI cache usage', () => {
  it('normalizes flat cached_tokens through the provider path', async () => {
    const provider = createTogetherAI({
      apiKey: 'test-api-key',
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: 'chatcmpl-cache-usage',
            object: 'chat.completion',
            created: 1,
            model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: 'Answer',
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
              cached_tokens: 4,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    });

    const result = await provider
      .chatModel('meta-llama/Llama-3.3-70B-Instruct-Turbo')
      .doGenerate({ prompt: TEST_PROMPT });

    expect(result.usage.raw).toMatchObject({ cached_tokens: 4 });
    expect(result.usage.inputTokens).toEqual({
      total: 10,
      noCache: 6,
      cacheRead: 4,
      cacheWrite: undefined,
    });
  });
});

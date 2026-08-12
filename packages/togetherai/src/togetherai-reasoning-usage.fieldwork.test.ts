import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import { createTogetherAI } from './togetherai-provider';

const TEST_PROMPT: LanguageModelV4Prompt = [
  { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
];

describe('Fieldwork: TogetherAI top-level reasoning usage', () => {
  it('preserves provider reasoning_tokens in normalized output details', async () => {
    const provider = createTogetherAI({
      apiKey: 'test-api-key',
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: 'chatcmpl-fieldwork',
            object: 'chat.completion',
            created: 1,
            model: 'moonshotai/Kimi-K3',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: 'Answer',
                  reasoning: 'Thinking',
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
              reasoning_tokens: 8,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    });

    const result = await provider
      .chatModel('moonshotai/Kimi-K3')
      .doGenerate({ prompt: TEST_PROMPT });

    expect(result.usage.raw).toMatchObject({ reasoning_tokens: 8 });
    expect(result.usage.outputTokens).toEqual({
      total: 20,
      text: 12,
      reasoning: 8,
    });
  });
});

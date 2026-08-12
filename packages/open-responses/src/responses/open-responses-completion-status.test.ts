import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { convertReadableStreamToArray, mockId } from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import { describe, expect, it } from 'vitest';
import { OpenResponsesLanguageModel } from './open-responses-language-model';

const URL = 'https://localhost:1234/v1/responses';
const TEST_PROMPT: LanguageModelV4Prompt = [
  { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
];

function responseBody(status: 'completed' | 'incomplete') {
  return {
    id: `resp_${status}`,
    object: 'response',
    created_at: 1741257730,
    status,
    incomplete_details:
      status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
    model: 'test-model',
    output: [
      {
        id: 'fc_1',
        type: 'function_call',
        call_id: 'call_1',
        name: 'weather',
        arguments: '{"location":"Paris"}',
        status,
      },
    ],
    usage: {
      input_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 2,
    },
  };
}

describe('OpenResponsesLanguageModel completion status', () => {
  const server = createTestServer({ [URL]: {} });

  function createModel() {
    return new OpenResponsesLanguageModel('test-model', {
      provider: 'test',
      providerOptionsName: 'test',
      url: URL,
      headers: () => ({}),
      generateId: mockId(),
    });
  }

  it.each(['completed', 'incomplete'] as const)(
    'doGenerate emits only completed function calls: %s',
    async status => {
      server.urls[URL].response = {
        type: 'json-value',
        body: responseBody(status),
      };

      const result = await createModel().doGenerate({ prompt: TEST_PROMPT });
      const toolCalls = result.content.filter(part => part.type === 'tool-call');

      expect(toolCalls).toHaveLength(status === 'completed' ? 1 : 0);
      expect(result.finishReason.unified).toBe(
        status === 'completed' ? 'tool-calls' : 'length',
      );
    },
  );

  it.each(['completed', 'incomplete'] as const)(
    'doStream emits only completed function calls: %s',
    async status => {
      const body = responseBody(status);
      server.urls[URL].response = {
        type: 'stream-chunks',
        chunks: [
          `data: ${JSON.stringify({
            type: 'response.output_item.added',
            sequence_number: 0,
            output_index: 0,
            item: { ...body.output[0], status: 'in_progress' },
          })}\n\n`,
          `data: ${JSON.stringify({
            type: 'response.output_item.done',
            sequence_number: 1,
            output_index: 0,
            item: body.output[0],
          })}\n\n`,
          `data: ${JSON.stringify({
            type:
              status === 'completed'
                ? 'response.completed'
                : 'response.incomplete',
            sequence_number: 2,
            response: body,
          })}\n\n`,
          'data: [DONE]\n\n',
        ],
      };

      const result = await createModel().doStream({ prompt: TEST_PROMPT });
      const parts = await convertReadableStreamToArray(result.stream);
      const toolCalls = parts.filter(part => part.type === 'tool-call');
      const finish = parts.find(part => part.type === 'finish');

      expect(toolCalls).toHaveLength(status === 'completed' ? 1 : 0);
      expect(finish?.type === 'finish' ? finish.finishReason.unified : undefined).toBe(
        status === 'completed' ? 'tool-calls' : 'length',
      );
    },
  );
});

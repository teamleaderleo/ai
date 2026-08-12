import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import {
  convertReadableStreamToArray,
  mockId,
} from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import { describe, expect, it } from 'vitest';
import { OpenResponsesLanguageModel } from './open-responses-language-model';

const TEST_PROMPT: LanguageModelV4Prompt = [
  { role: 'user', content: [{ type: 'text', text: 'Do something unsafe' }] },
];
const URL = 'https://localhost:1234/v1/responses';

const server = createTestServer({ [URL]: {} });

function createModel() {
  return new OpenResponsesLanguageModel('fieldwork-model', {
    provider: 'fieldwork',
    providerOptionsName: 'fieldwork',
    url: URL,
    headers: () => ({}),
    generateId: mockId(),
  });
}

const usage = {
  input_tokens: 5,
  output_tokens: 4,
  total_tokens: 9,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 0 },
};

function prepareGenerateContent(
  content:
    | { type: 'output_text'; text: string }
    | { type: 'refusal'; refusal: string },
) {
  server.urls[URL].response = {
    type: 'json-value',
    body: {
      id: 'resp_1',
      object: 'response',
      created_at: 1,
      status: 'completed',
      model: 'fieldwork-model',
      output: [
        {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [content],
        },
      ],
      usage,
    },
  };
}

function event(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function prepareStream({ refusal }: { refusal: boolean }) {
  const content = refusal
    ? { type: 'refusal', refusal: 'I cannot do that.' }
    : { type: 'output_text', text: 'I can help.' };

  const chunks = [
    event({
      type: 'response.output_item.added',
      sequence_number: 0,
      output_index: 0,
      item: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        status: 'in_progress',
        content: [],
      },
    }),
    ...(refusal
      ? [
          event({
            type: 'response.refusal.delta',
            sequence_number: 1,
            item_id: 'msg_1',
            output_index: 0,
            content_index: 0,
            delta: 'I cannot do that.',
          }),
          event({
            type: 'response.refusal.done',
            sequence_number: 2,
            item_id: 'msg_1',
            output_index: 0,
            content_index: 0,
            refusal: 'I cannot do that.',
          }),
        ]
      : [
          event({
            type: 'response.output_text.delta',
            sequence_number: 1,
            item_id: 'msg_1',
            output_index: 0,
            content_index: 0,
            delta: 'I can help.',
          }),
          event({
            type: 'response.output_text.done',
            sequence_number: 2,
            item_id: 'msg_1',
            output_index: 0,
            content_index: 0,
            text: 'I can help.',
          }),
        ]),
    event({
      type: 'response.output_item.done',
      sequence_number: 3,
      output_index: 0,
      item: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [content],
      },
    }),
    event({
      type: 'response.completed',
      sequence_number: 4,
      response: {
        id: 'resp_1',
        object: 'response',
        created_at: 1,
        status: 'completed',
        model: 'fieldwork-model',
        incomplete_details: null,
        output: [],
        usage,
      },
    }),
    'data: [DONE]\n\n',
  ];

  server.urls[URL].response = { type: 'stream-chunks', chunks };
}

describe('Fieldwork: Open Responses refusal parity', () => {
  it('turns a non-streaming refusal into malformed text on current source', async () => {
    prepareGenerateContent({
      type: 'refusal',
      refusal: 'I cannot do that.',
    });

    const result = await createModel().doGenerate({ prompt: TEST_PROMPT });

    expect(result.content).toEqual([
      {
        type: 'text',
        text: undefined,
      },
    ]);
  });

  it('keeps ordinary non-streaming output text as the negative control', async () => {
    prepareGenerateContent({ type: 'output_text', text: 'I can help.' });

    const result = await createModel().doGenerate({ prompt: TEST_PROMPT });

    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'I can help.',
      },
    ]);
  });

  it('drops refusal content from the streaming path on current source', async () => {
    prepareStream({ refusal: true });

    const result = await createModel().doStream({ prompt: TEST_PROMPT });
    const parts = await convertReadableStreamToArray(result.stream);

    expect(parts.filter(part => part.type === 'text-delta')).toEqual([]);
    expect(parts).toContainEqual({ type: 'text-start', id: 'msg_1' });
    expect(parts).toContainEqual({ type: 'text-end', id: 'msg_1' });
  });

  it('streams ordinary output text as the negative control', async () => {
    prepareStream({ refusal: false });

    const result = await createModel().doStream({ prompt: TEST_PROMPT });
    const parts = await convertReadableStreamToArray(result.stream);

    expect(parts).toContainEqual({
      type: 'text-delta',
      id: 'msg_1',
      delta: 'I can help.',
    });
  });
});

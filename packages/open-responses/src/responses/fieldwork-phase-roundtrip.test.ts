import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import { describe, expect, it } from 'vitest';
import { OpenResponsesLanguageModel } from './open-responses-language-model';

const URL = 'https://localhost:1234/v1/responses';

const server = createTestServer({
  [URL]: {},
});

function createModel() {
  return new OpenResponsesLanguageModel('fieldwork-model', {
    provider: 'fieldwork',
    providerOptionsName: 'fieldwork',
    url: URL,
    headers: () => ({}),
  });
}

function responseWithPhase(phase?: 'commentary' | 'final_answer') {
  return {
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
        content: [{ type: 'output_text', text: 'Working on it.' }],
        ...(phase == null ? {} : { phase }),
      },
    ],
    usage: {
      input_tokens: 5,
      output_tokens: 3,
      total_tokens: 8,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

const finalResponse = {
  id: 'resp_2',
  object: 'response',
  created_at: 2,
  status: 'completed',
  model: 'fieldwork-model',
  output: [
    {
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Done.' }],
    },
  ],
  usage: {
    input_tokens: 7,
    output_tokens: 1,
    total_tokens: 8,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
};

async function roundTrip(phase?: 'commentary' | 'final_answer') {
  server.urls[URL].response = {
    type: 'json-value',
    body: responseWithPhase(phase),
  };

  const model = createModel();
  const initialPrompt: LanguageModelV4Prompt = [
    { role: 'user', content: [{ type: 'text', text: 'Start' }] },
  ];

  const first = await model.doGenerate({ prompt: initialPrompt });

  server.urls[URL].response = { type: 'json-value', body: finalResponse };

  await model.doGenerate({
    prompt: [
      ...initialPrompt,
      { role: 'assistant', content: first.content },
      { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
    ],
  });

  return {
    first,
    secondRequest: await server.calls[1].requestBodyJson,
  };
}

describe('Fieldwork: Open Responses assistant phase round trip', () => {
  it('drops commentary phase before a follow-up request', async () => {
    const { first, secondRequest } = await roundTrip('commentary');

    expect(first.content).toEqual([
      {
        type: 'text',
        text: 'Working on it.',
      },
    ]);

    expect(
      secondRequest.input.filter(
        (item: { type?: string; role?: string }) =>
          item.type === 'message' && item.role === 'assistant',
      ),
    ).toEqual([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Working on it.' }],
      },
    ]);
  });

  it('keeps a phase-less assistant message unchanged', async () => {
    const { secondRequest } = await roundTrip();

    expect(
      secondRequest.input.filter(
        (item: { type?: string; role?: string }) =>
          item.type === 'message' && item.role === 'assistant',
      ),
    ).toEqual([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Working on it.' }],
      },
    ]);
  });
});

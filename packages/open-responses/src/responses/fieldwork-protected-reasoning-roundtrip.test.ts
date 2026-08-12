import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { mockId } from '@ai-sdk/provider-utils/test';
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
    generateId: mockId(),
  });
}

function firstResponse({
  content,
  encryptedContent,
}: {
  content: Array<{ type: 'reasoning_text'; text: string }>;
  encryptedContent?: string;
}) {
  return {
    id: 'resp_1',
    object: 'response',
    created_at: 1,
    status: 'completed',
    model: 'fieldwork-model',
    output: [
      {
        id: 'reasoning_1',
        type: 'reasoning',
        status: 'completed',
        summary: [
          {
            type: 'summary_text',
            text: 'safe summary',
          },
        ],
        content,
        encrypted_content: encryptedContent,
      },
      {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Continue when ready.' }],
      },
    ],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 2 },
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
    input_tokens: 12,
    output_tokens: 1,
    total_tokens: 13,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
};

async function runTwoTurnRoundTrip(response: ReturnType<typeof firstResponse>) {
  server.urls[URL].response = { type: 'json-value', body: response };

  const model = createModel();
  const initialPrompt: LanguageModelV4Prompt = [
    { role: 'user', content: [{ type: 'text', text: 'Think about this' }] },
  ];

  const first = await model.doGenerate({ prompt: initialPrompt });

  const assistantContent = first.content.flatMap(part => {
    switch (part.type) {
      case 'reasoning':
        return [
          {
            type: 'reasoning' as const,
            text: part.text,
            ...(part.providerMetadata != null
              ? { providerOptions: part.providerMetadata }
              : {}),
          },
        ];
      case 'text':
        return [
          {
            type: 'text' as const,
            text: part.text,
            ...(part.providerMetadata != null
              ? { providerOptions: part.providerMetadata }
              : {}),
          },
        ];
      default:
        return [];
    }
  });

  server.urls[URL].response = { type: 'json-value', body: finalResponse };

  const followupPrompt: LanguageModelV4Prompt = [
    ...initialPrompt,
    { role: 'assistant', content: assistantContent },
    { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
  ];

  await model.doGenerate({ prompt: followupPrompt });

  return {
    first,
    secondRequest: await server.calls[1].requestBodyJson,
  };
}

describe('Fieldwork: Open Responses protected reasoning round trip', () => {
  it('drops protected reasoning and its safe summary before the next turn', async () => {
    const { first, secondRequest } = await runTwoTurnRoundTrip(
      firstResponse({
        content: [],
        encryptedContent: 'opaque-provider-state',
      }),
    );

    expect(first.content.filter(part => part.type === 'reasoning')).toEqual([]);
    expect(first.providerMetadata).toBeUndefined();
    expect(
      secondRequest.input.filter(
        (item: { type?: string }) => item.type === 'reasoning',
      ),
    ).toEqual([]);
  });

  it('keeps raw reasoning text through the same next-turn replay path', async () => {
    const { first, secondRequest } = await runTwoTurnRoundTrip(
      firstResponse({
        content: [
          {
            type: 'reasoning_text',
            text: 'visible provider reasoning',
          },
        ],
      }),
    );

    expect(first.content).toContainEqual({
      type: 'reasoning',
      text: 'visible provider reasoning',
    });
    expect(
      secondRequest.input.filter(
        (item: { type?: string }) => item.type === 'reasoning',
      ),
    ).toEqual([
      {
        type: 'reasoning',
        summary: [],
        content: [
          {
            type: 'reasoning_text',
            text: 'visible provider reasoning',
          },
        ],
      },
    ]);
  });
});

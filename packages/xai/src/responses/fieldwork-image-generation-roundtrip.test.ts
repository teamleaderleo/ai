import { describe, expect, it } from 'vitest';
import { convertToXaiResponsesInput } from './convert-to-xai-responses-input';

describe('Fieldwork: xAI provider-executed image history', () => {
  it('drops provider-executed image generation call/result from self-managed replay', async () => {
    const result = await convertToXaiResponsesInput({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'make a red cube' }],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'ig_123',
              toolName: 'image_generation',
              input: {},
              providerExecuted: true,
            },
            {
              type: 'tool-result',
              toolCallId: 'ig_123',
              toolName: 'image_generation',
              output: {
                type: 'json',
                value: {
                  prompt: 'a red cube',
                  result: 'base64-image-data',
                },
              },
            },
            { type: 'text', text: 'Here is the cube.' },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'make it blue' }],
        },
      ],
    });

    expect(result.input).toEqual([
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'make a red cube' }],
      },
      {
        role: 'assistant',
        content: 'Here is the cube.',
        id: undefined,
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'make it blue' }],
      },
    ]);
  });

  it('keeps a client-executed function call as a negative control', async () => {
    const result = await convertToXaiResponsesInput({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_123',
              toolName: 'paint',
              input: { color: 'blue' },
            },
          ],
        },
      ],
    });

    expect(result.input).toEqual([
      {
        type: 'function_call',
        id: 'call_123',
        call_id: 'call_123',
        name: 'paint',
        arguments: JSON.stringify({ color: 'blue' }),
        status: 'completed',
      },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { convertToModelMessages } from '../../../ai/src/ui/convert-to-model-messages';
import { convertToXaiResponsesInput } from './convert-to-xai-responses-input';

describe('Fieldwork: xAI generated-image persisted history composition', () => {
  it('preserves the completed image tool in core history but drops it at the xAI request boundary', async () => {
    const modelMessages = await convertToModelMessages([
      {
        role: 'user',
        parts: [{ type: 'text', text: 'make a red cube' }],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'image_generation',
            toolCallId: 'ig_123',
            providerExecuted: true,
            state: 'output-available',
            input: {},
            output: {
              prompt: 'a red cube',
              result: 'base64-image-data',
            },
          },
          { type: 'text', text: 'Here is the cube.' },
        ],
      },
      {
        role: 'user',
        parts: [{ type: 'text', text: 'make it blue' }],
      },
    ]);

    expect(modelMessages).toContainEqual({
      role: 'assistant',
      content: expect.arrayContaining([
        expect.objectContaining({
          type: 'tool-call',
          toolCallId: 'ig_123',
          toolName: 'image_generation',
          providerExecuted: true,
        }),
        expect.objectContaining({
          type: 'tool-result',
          toolCallId: 'ig_123',
          toolName: 'image_generation',
        }),
      ]),
    });

    const { input } = await convertToXaiResponsesInput({
      prompt: modelMessages,
    });

    expect(input).not.toContainEqual(
      expect.objectContaining({
        type: 'image_generation_call',
        id: 'ig_123',
      }),
    );
    expect(input).not.toContainEqual(
      expect.objectContaining({
        type: 'function_call',
        id: 'ig_123',
      }),
    );

    expect(input).toContainEqual({
      role: 'assistant',
      content: 'Here is the cube.',
      id: undefined,
    });
    expect(input).toContainEqual({
      role: 'user',
      content: [{ type: 'input_text', text: 'make it blue' }],
    });
  });
});

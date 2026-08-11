import { describe, expect, it } from 'vitest';
import { convertToModelMessages } from '../../../ai/src/ui/convert-to-model-messages';
import { convertToXaiResponsesInput } from './convert-to-xai-responses-input';

describe('Fieldwork: xAI generated-image persisted history composition', () => {
  it('round-trips a completed provider-executed image generation item from persisted UI history', async () => {
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

    expect(input).toContainEqual({
      type: 'image_generation_call',
      id: 'ig_123',
      status: 'completed',
      prompt: 'a red cube',
      result: 'base64-image-data',
    });

    expect(input).toContainEqual({
      role: 'user',
      content: [{ type: 'input_text', text: 'make it blue' }],
    });
  });
});

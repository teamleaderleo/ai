import { describe, expect, it } from 'vitest';
import { convertToModelMessages } from '../../../ai/src/ui/convert-to-model-messages';
import { convertToXaiResponsesInput } from './convert-to-xai-responses-input';

describe('Fieldwork #854: persisted UI image-generation history', () => {
  it('is preserved by core model conversion and then removed by xAI input conversion', async () => {
    const generatedImage = 'A'.repeat(1024);
    const uiMessages = [
      {
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'Generate a blue robot.' }],
      },
      {
        role: 'assistant' as const,
        parts: [
          { type: 'step-start' as const },
          {
            type: 'tool-image_generation' as const,
            state: 'output-available' as const,
            toolCallId: 'ig_123',
            input: {},
            output: {
              result: generatedImage,
              prompt: 'A friendly blue robot',
            },
            providerExecuted: true,
          },
          {
            type: 'text' as const,
            text: 'Here is the robot.',
            state: 'done' as const,
          },
        ],
      },
      {
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'Make it red.' }],
      },
    ];

    const modelMessages = await convertToModelMessages(uiMessages);
    const assistant = modelMessages[1];

    expect(assistant).toMatchObject({ role: 'assistant' });
    expect(assistant.content).toEqual(
      expect.arrayContaining([
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
    );
    expect(JSON.stringify(modelMessages)).toContain(generatedImage);

    const xai = await convertToXaiResponsesInput({ prompt: modelMessages });

    expect(JSON.stringify(xai.input)).not.toContain(generatedImage);
    expect(xai.input).toEqual([
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Generate a blue robot.' }],
      },
      {
        role: 'assistant',
        content: 'Here is the robot.',
        id: undefined,
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Make it red.' }],
      },
    ]);
  });
});

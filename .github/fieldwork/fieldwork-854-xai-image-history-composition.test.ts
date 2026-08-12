import { describe, expect, it } from 'vitest';
import { convertToLanguageModelMessage } from '../../../ai/src/prompt/convert-to-language-model-prompt';
import { convertToModelMessages } from '../../../ai/src/ui/convert-to-model-messages';
import { convertToXaiResponsesInput } from './convert-to-xai-responses-input';

describe('Fieldwork #854: persisted xAI image history composition', () => {
  it('survives UI, public-model, provider-V4, and xAI request conversion', async () => {
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
    const providerPrompt = modelMessages.map(message =>
      convertToLanguageModelMessage({
        message,
        downloadedAssets: {},
        provider: 'xai',
      }),
    );

    const xai = await convertToXaiResponsesInput({ prompt: providerPrompt });

    expect(JSON.stringify(xai.input)).toContain(generatedImage);
    expect(xai.input).toEqual([
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Generate a blue robot.' }],
      },
      {
        type: 'image_generation_call',
        id: 'ig_123',
        result: generatedImage,
        status: 'completed',
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

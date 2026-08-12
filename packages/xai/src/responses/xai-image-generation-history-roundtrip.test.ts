import { describe, expect, it } from 'vitest';
import { convertToModelMessages } from '../../../ai/src/ui/convert-to-model-messages';
import { convertToXaiResponsesInput } from './convert-to-xai-responses-input';

describe('xAI persisted image-generation history', () => {
  it('round-trips a persisted generated image through UI and provider conversion', async () => {
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
    const xai = await convertToXaiResponsesInput({ prompt: modelMessages });

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

  it('recognizes a renamed provider image tool from its persisted result pair', async () => {
    const result = await convertToXaiResponsesInput({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'ig_renamed',
              toolName: 'make_picture',
              input: '{}',
              providerExecuted: true,
            },
            {
              type: 'tool-result',
              toolCallId: 'ig_renamed',
              toolName: 'make_picture',
              output: {
                type: 'json',
                value: {
                  result: 'BASE64_IMAGE',
                  prompt: 'A small red robot',
                },
              },
            },
          ],
        },
      ],
    });

    expect(result.input).toEqual([
      {
        type: 'image_generation_call',
        id: 'ig_renamed',
        result: 'BASE64_IMAGE',
        status: 'completed',
      },
    ]);
  });

  it('continues to skip unrelated provider-executed tool history', async () => {
    const result = await convertToXaiResponsesInput({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'fs_123',
              toolName: 'file_search',
              input: '',
              providerExecuted: true,
            },
            {
              type: 'tool-result',
              toolCallId: 'fs_123',
              toolName: 'file_search',
              output: {
                type: 'json',
                value: { queries: ['robot'], results: null },
              },
            },
          ],
        },
      ],
    });

    expect(result.input).toEqual([]);
  });

  it('continues to serialize client tools normally even with result-like input', async () => {
    const result = await convertToXaiResponsesInput({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'client_123',
              toolName: 'make_picture',
              input: { result: 'not-provider-history' },
            },
          ],
        },
      ],
    });

    expect(result.input).toEqual([
      {
        type: 'function_call',
        id: 'client_123',
        call_id: 'client_123',
        name: 'make_picture',
        arguments: '{"result":"not-provider-history"}',
        status: 'completed',
      },
    ]);
  });
});

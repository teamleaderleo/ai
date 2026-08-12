import { describe, expect, it } from 'vitest';
import { convertToXaiResponsesInput } from './convert-to-xai-responses-input';

describe('xAI persisted image-generation history', () => {
  it('reconstructs a successful provider-executed image result', async () => {
    const result = await convertToXaiResponsesInput({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'ig_123',
              toolName: 'image_generation',
              input: '{}',
              providerExecuted: true,
            },
            {
              type: 'tool-result',
              toolCallId: 'ig_123',
              toolName: 'image_generation',
              output: {
                type: 'json',
                value: {
                  result: 'BASE64_IMAGE',
                  prompt: 'A friendly blue robot',
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
        id: 'ig_123',
        result: 'BASE64_IMAGE',
        status: 'completed',
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

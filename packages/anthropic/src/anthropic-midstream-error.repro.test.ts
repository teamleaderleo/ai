import { APICallError, type LanguageModelV4Prompt } from '@ai-sdk/provider';
import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { describe, expect, it } from 'vitest';
import { createAnthropic } from './anthropic-provider';

const TEST_PROMPT: LanguageModelV4Prompt = [
  { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
];

const messageStart = {
  type: 'message_start',
  message: {
    model: 'claude-sonnet-4-5-20250929',
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: 12,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: {
        ephemeral_5m_input_tokens: 0,
        ephemeral_1h_input_tokens: 0,
      },
      output_tokens: 1,
      service_tier: 'standard',
    },
  },
};

function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}

function createModel(events: unknown[]) {
  const provider = createAnthropic({
    apiKey: 'test-api-key',
    fetch: async () => sseResponse(events),
  });
  return provider('claude-sonnet-4-5-20250929');
}

describe('Anthropic streamed provider error classification', () => {
  it('control: classifies an initial overloaded error as APICallError', async () => {
    const model = createModel([
      {
        type: 'error',
        error: { type: 'overloaded_error', message: 'Overloaded' },
      },
    ]);

    let caught: unknown;
    try {
      await model.doStream({ prompt: TEST_PROMPT });
    } catch (error) {
      caught = error;
    }

    expect(APICallError.isInstance(caught)).toBe(true);
    if (!APICallError.isInstance(caught)) {
      throw new Error('expected APICallError');
    }

    expect(caught.message).toBe('Overloaded');
    expect(caught.statusCode).toBe(529);
    expect(caught.isRetryable).toBe(true);
    expect(caught.responseBody).toBe(
      JSON.stringify({ type: 'overloaded_error', message: 'Overloaded' }),
    );
  });

  it('classifies the same overloaded error as APICallError after streaming starts', async () => {
    const model = createModel([
      messageStart,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      },
      {
        type: 'error',
        error: { type: 'overloaded_error', message: 'Overloaded' },
      },
    ]);

    const { stream } = await model.doStream({ prompt: TEST_PROMPT });
    const parts = await convertReadableStreamToArray(stream);
    const errorPart = parts.find(part => part.type === 'error');

    expect(errorPart).toBeDefined();
    if (errorPart?.type !== 'error') {
      throw new Error('expected error stream part');
    }

    expect(APICallError.isInstance(errorPart.error)).toBe(true);
    if (!APICallError.isInstance(errorPart.error)) {
      throw new Error(
        `expected APICallError, received ${Object.prototype.toString.call(errorPart.error)}`,
      );
    }

    expect(errorPart.error.message).toBe('Overloaded');
    expect(errorPart.error.statusCode).toBe(529);
    expect(errorPart.error.isRetryable).toBe(true);
    expect(errorPart.error.responseBody).toBe(
      JSON.stringify({ type: 'overloaded_error', message: 'Overloaded' }),
    );
  });

  it('uses the existing first-error mapping for non-overload mid-stream errors', async () => {
    const model = createModel([
      messageStart,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      },
      {
        type: 'error',
        error: { type: 'api_error', message: 'Internal server error' },
      },
    ]);

    const { stream } = await model.doStream({ prompt: TEST_PROMPT });
    const parts = await convertReadableStreamToArray(stream);
    const errorPart = parts.find(part => part.type === 'error');

    expect(errorPart?.type).toBe('error');
    if (errorPart?.type !== 'error') {
      throw new Error('expected error stream part');
    }

    expect(APICallError.isInstance(errorPart.error)).toBe(true);
    if (!APICallError.isInstance(errorPart.error)) {
      throw new Error('expected APICallError');
    }

    expect(errorPart.error.message).toBe('Internal server error');
    expect(errorPart.error.statusCode).toBe(500);
    expect(errorPart.error.isRetryable).toBe(false);
  });
});

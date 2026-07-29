import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test';
import { describe, expect, it } from 'vitest';
import { createMockServerResponse } from '../test/mock-server-response';
import { MockLanguageModelV4 } from '../test/mock-language-model-v4';
import { streamText } from './stream-text';

const testUsage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 1,
    text: 1,
    reasoning: undefined,
  },
};

const createResult = () =>
  streamText({
    model: new MockLanguageModelV4({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: 'stream-start' as const, warnings: [] },
          { type: 'text-start' as const, id: 'text-1' },
          {
            type: 'text-delta' as const,
            id: 'text-1',
            delta: 'Hello',
          },
          { type: 'text-end' as const, id: 'text-1' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop' as const, raw: 'stop' },
            usage: testUsage,
          },
        ]),
      }),
    }),
    prompt: 'Hello',
  });

describe('streamText UI response keepAliveMs', () => {
  it('forwards keepAliveMs through toUIMessageStreamResponse', async () => {
    const response = createResult().toUIMessageStreamResponse({
      keepAliveMs: 1000,
    });
    const reader = response.body!
      .pipeThrough(new TextDecoderStream())
      .getReader();

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: ': stream-open\n\n',
    });
    await reader.cancel();
  });

  it(
    'forwards keepAliveMs through pipeUIMessageStreamToResponse',
    async () => {
      const response = createMockServerResponse();

      await createResult().pipeUIMessageStreamToResponse(response, {
        keepAliveMs: 1000,
      });
      await response.waitForEnd();

      expect(response.getDecodedChunks()[0]).toBe(': stream-open\n\n');
    },
  );
});

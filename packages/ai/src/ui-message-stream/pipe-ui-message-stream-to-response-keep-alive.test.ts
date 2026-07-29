import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test';
import { describe, expect, it, vi } from 'vitest';
import { createMockServerResponse } from '../test/mock-server-response';
import type { UIMessageChunk } from './ui-message-chunks';
import { pipeUIMessageStreamToResponse } from './pipe-ui-message-stream-to-response';

describe('pipeUIMessageStreamToResponse keepAliveMs', () => {
  it('writes the opening comment before canonical SSE data', async () => {
    const response = createMockServerResponse();

    await pipeUIMessageStreamToResponse({
      response,
      keepAliveMs: 1000,
      stream: convertArrayToReadableStream<UIMessageChunk>([
        { type: 'text-delta', id: 'text-1', delta: 'Hello' },
      ]),
    });
    await response.waitForEnd();

    expect(response.getDecodedChunks()).toEqual([
      ': stream-open\n\n',
      'data: {"type":"text-delta","id":"text-1","delta":"Hello"}\n\n',
      'data: [DONE]\n\n',
    ]);
  });

  it('validates before locking the source or starting consumeSseStream', () => {
    const response = createMockServerResponse();
    const stream = new ReadableStream<UIMessageChunk>();
    const consumeSseStream = vi.fn();

    expect(() =>
      pipeUIMessageStreamToResponse({
        response,
        stream,
        keepAliveMs: 0,
        consumeSseStream,
      }),
    ).toThrow('keepAliveMs must be a finite number greater than 0.');
    expect(stream.locked).toBe(false);
    expect(consumeSseStream).not.toHaveBeenCalled();
  });
});

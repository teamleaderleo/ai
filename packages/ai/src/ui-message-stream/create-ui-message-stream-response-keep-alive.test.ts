import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessageChunk } from './ui-message-chunks';
import { createUIMessageStreamResponse } from './create-ui-message-stream-response';

const decode = (response: Response) =>
  response.body!.pipeThrough(new TextDecoderStream());

async function isSettled<T>(promise: Promise<T>): Promise<boolean> {
  let settled = false;
  void promise.finally(() => {
    settled = true;
  });
  await Promise.resolve();
  return settled;
}

describe('createUIMessageStreamResponse keepAliveMs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits an immediate comment, emits on idle, and resets after real data', async () => {
    let sourceController!: ReadableStreamDefaultController<UIMessageChunk>;
    const source = new ReadableStream<UIMessageChunk>({
      start(controller) {
        sourceController = controller;
      },
    });

    const response = createUIMessageStreamResponse({
      stream: source,
      keepAliveMs: 1000,
    });
    const reader = decode(response).getReader();

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: ': stream-open\n\n',
    });

    const firstHeartbeat = reader.read();
    await vi.advanceTimersByTimeAsync(999);
    expect(await isSettled(firstHeartbeat)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(firstHeartbeat).resolves.toEqual({
      done: false,
      value: ': keep-alive\n\n',
    });

    const data = reader.read();
    sourceController.enqueue({
      type: 'text-delta',
      id: 'text-1',
      delta: 'Hello',
    });
    await expect(data).resolves.toEqual({
      done: false,
      value: 'data: {"type":"text-delta","id":"text-1","delta":"Hello"}\n\n',
    });

    const secondHeartbeat = reader.read();
    await vi.advanceTimersByTimeAsync(999);
    expect(await isSettled(secondHeartbeat)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(secondHeartbeat).resolves.toEqual({
      done: false,
      value: ': keep-alive\n\n',
    });

    const donePart = reader.read();
    sourceController.close();
    await expect(donePart).resolves.toEqual({
      done: false,
      value: 'data: [DONE]\n\n',
    });
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the heartbeat timer and eventually cancels the source branch', async () => {
    let resolveSourceCancelled!: () => void;
    const sourceCancelled = new Promise<void>(resolve => {
      resolveSourceCancelled = resolve;
    });
    const sourceCancel = vi.fn(() => {
      resolveSourceCancelled();
    });
    const source = new ReadableStream<UIMessageChunk>({
      cancel: sourceCancel,
    });

    const response = createUIMessageStreamResponse({
      stream: source,
      keepAliveMs: 1000,
    });
    const reader = decode(response).getReader();

    await reader.read();
    await reader.cancel(new Error('client disconnected'));

    // The client cancellation promise is deliberately independent of the
    // downstream source branch, but cancellation still propagates eventually.
    await sourceCancelled;
    expect(sourceCancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not wait for an independent consumeSseStream branch when the client cancels', async () => {
    let persistenceStream!: ReadableStream<string>;
    const source = new ReadableStream<UIMessageChunk>();
    const response = createUIMessageStreamResponse({
      stream: source,
      keepAliveMs: 1000,
      consumeSseStream({ stream }) {
        persistenceStream = stream;
      },
    });
    const reader = decode(response).getReader();

    await reader.read();
    await expect(reader.cancel('client disconnected')).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);

    // The independent branch can continue or clean up on its own schedule.
    await persistenceStream.cancel('test cleanup');
  });

  it('keeps synthetic comments out of consumeSseStream', async () => {
    let sourceController!: ReadableStreamDefaultController<UIMessageChunk>;
    const source = new ReadableStream<UIMessageChunk>({
      start(controller) {
        sourceController = controller;
      },
    });
    let consumedPromise!: Promise<string[]>;

    const response = createUIMessageStreamResponse({
      stream: source,
      keepAliveMs: 1000,
      consumeSseStream({ stream }) {
        consumedPromise = convertReadableStreamToArray(stream);
      },
    });

    const responsePromise = convertReadableStreamToArray(decode(response));
    sourceController.enqueue({
      type: 'text-delta',
      id: 'text-1',
      delta: 'Hello',
    });
    sourceController.close();

    await expect(responsePromise).resolves.toEqual([
      ': stream-open\n\n',
      'data: {"type":"text-delta","id":"text-1","delta":"Hello"}\n\n',
      'data: [DONE]\n\n',
    ]);
    await expect(consumedPromise).resolves.toEqual([
      'data: {"type":"text-delta","id":"text-1","delta":"Hello"}\n\n',
      'data: [DONE]\n\n',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
    'rejects invalid interval %s before locking or teeing the source',
    keepAliveMs => {
      const source = new ReadableStream<UIMessageChunk>();
      const consumeSseStream = vi.fn();

      expect(() =>
        createUIMessageStreamResponse({
          stream: source,
          keepAliveMs,
          consumeSseStream,
        }),
      ).toThrow('keepAliveMs must be a finite number greater than 0.');
      expect(source.locked).toBe(false);
      expect(consumeSseStream).not.toHaveBeenCalled();
    },
  );
});

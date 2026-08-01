import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from '../test/mock-language-model-v4';
import { streamLanguageModelCall } from './stream-language-model-call';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function settleWithin<T>(promise: PromiseLike<T>, timeoutMs = 50) {
  return await Promise.race([
    Promise.resolve(promise).then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    ),
    new Promise<{ status: 'pending' }>(resolve => {
      setTimeout(() => resolve({ status: 'pending' }), timeoutMs);
    }),
  ]);
}

function createModel(
  cancel: (reason: unknown) => Promise<void> | void,
): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        cancel,
      }),
    }),
  });
}

describe('streamLanguageModelCall provider cancellation', () => {
  it('settles cancellation after requesting provider cleanup that remains pending', async () => {
    const abortController = new AbortController();
    const abortReason = new DOMException('stop operation', 'AbortError');
    const cancelRequested = deferred<unknown>();
    const providerCleanup = deferred<void>();

    const result = await streamLanguageModelCall({
      model: createModel(reason => {
        cancelRequested.resolve(reason);
        return providerCleanup.promise;
      }),
      prompt: 'test-input',
      abortSignal: abortController.signal,
    });

    abortController.abort(abortReason);

    expect(await settleWithin(result.stream.cancel(abortReason))).toMatchObject({
      status: 'resolved',
    });
    expect(await settleWithin(cancelRequested.promise)).toMatchObject({
      status: 'resolved',
      value: abortReason,
    });
    expect(await settleWithin(providerCleanup.promise, 25)).toMatchObject({
      status: 'pending',
    });
  });

  it('contains a rejected provider cleanup promise', async () => {
    const abortController = new AbortController();
    const abortReason = new DOMException('stop operation', 'AbortError');

    const result = await streamLanguageModelCall({
      model: createModel(() => Promise.reject(new Error('cleanup failed'))),
      prompt: 'test-input',
      abortSignal: abortController.signal,
    });

    abortController.abort(abortReason);

    expect(await settleWithin(result.stream.cancel(abortReason))).toMatchObject({
      status: 'resolved',
    });

    // Vitest treats an unhandled provider cleanup rejection as a test failure.
    await Promise.resolve();
    await Promise.resolve();
  });
});

import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from '../test/mock-language-model-v4';
import { streamText } from './stream-text';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function settleWithin<T>(promise: PromiseLike<T>, timeoutMs = 100) {
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

async function collectStream(
  stream: AsyncIterable<unknown>,
): Promise<
  | { status: 'resolved'; parts: unknown[] }
  | { status: 'rejected'; error: unknown }
> {
  try {
    const parts = [];
    for await (const part of stream) {
      parts.push(part);
    }
    return { status: 'resolved', parts };
  } catch (error) {
    return { status: 'rejected', error };
  }
}

function expectAbortRejection(
  outcome: Awaited<ReturnType<typeof settleWithin>>,
  reason: DOMException,
) {
  expect(outcome.status).toBe('rejected');
  if (outcome.status === 'rejected') {
    expect(outcome.error).toBe(reason);
  }
}

function expectSingleAbortPart(
  outcome: Awaited<ReturnType<typeof collectStream>>,
) {
  expect(outcome.status).toBe('resolved');
  if (outcome.status === 'resolved') {
    expect(
      outcome.parts.filter(
        part =>
          typeof part === 'object' &&
          part != null &&
          'type' in part &&
          part.type === 'abort',
      ),
    ).toHaveLength(1);
  }
}

describe('streamText explicit abort races', () => {
  it('does not let a pending onAbort callback delay provider cancellation or outward stream closure', async () => {
    const abortController = new AbortController();
    const abortReason = new DOMException('stop now', 'AbortError');
    const providerStarted = deferred<void>();
    const providerCancelled = deferred<void>();
    const releaseOnAbort = deferred<void>();

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              providerStarted.resolve();
            },
            cancel() {
              providerCancelled.resolve();
            },
          }),
        }),
      }),
      prompt: 'test-input',
      abortSignal: abortController.signal,
      onAbort: vi.fn(() => releaseOnAbort.promise),
    });

    const streamOutcomePromise = collectStream(result.stream);

    await providerStarted.promise;
    abortController.abort(abortReason);

    try {
      expectAbortRejection(await settleWithin(result.steps, 50), abortReason);
      expect(await settleWithin(providerCancelled.promise, 50)).toMatchObject({
        status: 'resolved',
      });
      expect(await settleWithin(streamOutcomePromise, 50)).toMatchObject({
        status: 'resolved',
      });
    } finally {
      releaseOnAbort.resolve();
      await streamOutcomePromise;
    }
  });

  it('keeps abort as the single outward outcome when a provider error arrives immediately afterward', async () => {
    const abortController = new AbortController();
    const abortReason = new DOMException('caller stopped', 'AbortError');
    const providerStarted = deferred<void>();
    const providerError = new Error('provider failed after abort');
    let providerController:
      | ReadableStreamDefaultController<LanguageModelV4StreamPart>
      | undefined;
    const onAbort = vi.fn();
    const onError = vi.fn();

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              providerController = controller;
              controller.enqueue({ type: 'stream-start', warnings: [] });
              providerStarted.resolve();
            },
          }),
        }),
      }),
      prompt: 'test-input',
      abortSignal: abortController.signal,
      onAbort,
      onError,
    });

    const streamOutcomePromise = collectStream(result.stream);

    await providerStarted.promise;
    abortController.abort(abortReason);
    providerController?.error(providerError);

    expectAbortRejection(await settleWithin(result.steps), abortReason);
    expectSingleAbortPart(await streamOutcomePromise);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps provider cancel rejection internal when abort wins before stream registration', async () => {
    const abortController = new AbortController();
    const abortReason = new DOMException('pre-registration stop', 'AbortError');
    const cancelError = new Error('provider cancel failed');
    const providerCancel = vi.fn(() => Promise.reject(cancelError));
    const onAbort = vi.fn();
    const onError = vi.fn();

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => {
          const stream = new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
            },
            cancel: providerCancel,
          });
          abortController.abort(abortReason);
          return { stream };
        },
      }),
      prompt: 'test-input',
      abortSignal: abortController.signal,
      onAbort,
      onError,
    });

    const streamOutcomePromise = collectStream(result.stream);

    expectAbortRejection(await settleWithin(result.steps), abortReason);
    expectSingleAbortPart(await streamOutcomePromise);
    await vi.waitFor(() => expect(providerCancel).toHaveBeenCalledTimes(1));
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('settles public abort results while pre-registration provider cancellation is pending', async () => {
    const abortController = new AbortController();
    const abortReason = new DOMException('pending provider cancel', 'AbortError');
    const releaseProviderCancel = deferred<void>();
    const providerCancel = vi.fn(() => releaseProviderCancel.promise);
    const onAbort = vi.fn();

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => {
          const stream = new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
            },
            cancel: providerCancel,
          });
          abortController.abort(abortReason);
          return { stream };
        },
      }),
      prompt: 'test-input',
      abortSignal: abortController.signal,
      onAbort,
    });

    const streamOutcomePromise = collectStream(result.stream);

    try {
      expectAbortRejection(await settleWithin(result.steps, 50), abortReason);
      expect(await settleWithin(streamOutcomePromise, 50)).toMatchObject({
        status: 'resolved',
      });
      await vi.waitFor(() => expect(providerCancel).toHaveBeenCalledTimes(1));
      expect(onAbort).toHaveBeenCalledTimes(1);
    } finally {
      releaseProviderCancel.resolve();
      await streamOutcomePromise;
    }
  });

  it('emits one abort outcome to each active consumer while invoking onAbort once', async () => {
    const abortController = new AbortController();
    const abortReason = new DOMException('shared stop', 'AbortError');
    const providerStarted = deferred<void>();
    const providerCancel = vi.fn();
    const onAbort = vi.fn();

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              providerStarted.resolve();
            },
            cancel: providerCancel,
          }),
        }),
      }),
      prompt: 'test-input',
      abortSignal: abortController.signal,
      onAbort,
    });

    const firstConsumer = collectStream(result.stream);
    const secondConsumer = collectStream(result.stream);
    const stepsOutcomePromise = settleWithin(result.steps);

    await providerStarted.promise;
    abortController.abort(abortReason);

    expectAbortRejection(await stepsOutcomePromise, abortReason);

    for (const outcome of await Promise.all([firstConsumer, secondConsumer])) {
      expectSingleAbortPart(outcome);
    }

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(providerCancel).toHaveBeenCalledTimes(1);
  });
});
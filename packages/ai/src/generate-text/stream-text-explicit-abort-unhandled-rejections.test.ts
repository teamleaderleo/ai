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

async function collectStream(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _part of stream) {
    // Consume every outward part so stream settlement is observed.
  }
}

async function flushUnhandledRejections(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('streamText explicit abort rejection ownership', () => {
  it('observes every delayed abort rejection before settlement', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      for (const withExplicitReason of [true, false]) {
        const abortController = new AbortController();
        const providerStarted = deferred<void>();
        const explicitReason = new DOMException('caller stopped', 'AbortError');
        const result = streamText({
          model: new MockLanguageModelV4({
            doStream: async () => ({
              stream: new ReadableStream<LanguageModelV4StreamPart>({
                start(controller) {
                  controller.enqueue({ type: 'stream-start', warnings: [] });
                  providerStarted.resolve();
                },
              }),
            }),
          }),
          prompt: 'test-input',
          abortSignal: abortController.signal,
        });
        const streamOutcome = collectStream(result.stream);

        await providerStarted.promise;
        if (withExplicitReason) {
          abortController.abort(explicitReason);
        } else {
          abortController.abort();
        }

        const expectedReason = abortController.signal.reason;
        await expect(result.steps).rejects.toBe(expectedReason);
        await streamOutcome;
      }

      await flushUnhandledRejections();
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  it('observes initial-response rejection before prepareStep failure settlement', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const setupError = new Error('prepareStep failed');
      const doStream = vi.fn();
      const result = streamText({
        model: new MockLanguageModelV4({ doStream }),
        prompt: 'test-input',
        prepareStep: () => {
          throw setupError;
        },
      });

      await collectStream(result.stream);
      await expect(result.responseMessages).rejects.toMatchObject({
        name: 'AI_NoOutputGeneratedError',
        message: 'No output generated. Check the stream for errors.',
      });
      expect(doStream).not.toHaveBeenCalled();
      await flushUnhandledRejections();

      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });
});

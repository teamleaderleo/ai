from pathlib import Path

source_path = Path('packages/ai/src/generate-text/stream-text.ts')
source = source_path.read_text(encoding='utf-8')

helper = """async function markPromiseAsHandled<T>(promise: Promise<T>): Promise<void> {
  try {
    await promise;
  } catch {}
}

"""
if source.count(helper) != 1:
    raise SystemExit(f'expected one async adoption helper, found {source.count(helper)}')
source = source.replace(helper, '', 1)

setup_old = """      await telemetryDispatcher.onError?.({ callId, error });
      self._initialResponseMessages.reject(error);
      markPromiseAsHandled(self._initialResponseMessages.promise);
"""
setup_new = """      await telemetryDispatcher.onError?.({ callId, error });
      const initialResponseMessagesPromise =
        self._initialResponseMessages.promise;
      void initialResponseMessagesPromise.catch(() => {});
      self._initialResponseMessages.reject(error);
"""
if source.count(setup_old) != 1:
    raise SystemExit(
        f'expected one initial-response rejection boundary, found {source.count(setup_old)}'
    )
source = source.replace(setup_old, setup_new, 1)

reject_old = """    if (delayedPromise.isPending()) {
      delayedPromise.reject(error);
      markPromiseAsHandled(delayedPromise.promise);
    }
"""
reject_new = """    if (delayedPromise.isPending()) {
      const promise = delayedPromise.promise;
      void promise.catch(() => {});
      delayedPromise.reject(error);
    }
"""
if source.count(reject_old) != 1:
    raise SystemExit(
        f'expected one delayed-result rejection boundary, found {source.count(reject_old)}'
    )
source_path.write_text(source.replace(reject_old, reject_new, 1), encoding='utf-8')

test_path = Path(
    'packages/ai/src/generate-text/stream-text-explicit-abort-unhandled-rejections.test.ts'
)
if test_path.exists():
    raise SystemExit(f'{test_path} already exists')

test_path.write_text(
    """import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
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
""",
    encoding='utf-8',
)

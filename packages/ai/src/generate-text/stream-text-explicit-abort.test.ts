import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { tool } from '@ai-sdk/provider-utils';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function settleWithin<T>(promise: PromiseLike<T>, timeoutMs = 250) {
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

function expectAbortRejection(
  outcome: Awaited<ReturnType<typeof settleWithin>>,
  message: string,
) {
  expect(outcome.status).toBe('rejected');
  if (outcome.status === 'rejected') {
    expect(outcome.error).toBeInstanceOf(DOMException);
    expect((outcome.error as DOMException).name).toBe('AbortError');
    expect((outcome.error as DOMException).message).toBe(message);
  }
}

describe('streamText explicit abort terminal settlement', () => {
  it('settles root promises and representative derived getters when abort fires during a pending provider read', async () => {
    const abortController = new AbortController();
    const abortReason = new DOMException(
      'fieldwork explicit abort',
      'AbortError',
    );
    const providerStarted = deferred<void>();
    const providerCancelled = deferred<void>();
    const onAbort = vi.fn();
    const onEnd = vi.fn();
    const onError = vi.fn();

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              controller.enqueue({
                type: 'response-metadata',
                id: 'response-id',
                modelId: 'mock-model-id',
                timestamp: new Date(0),
              });
              controller.enqueue({ type: 'text-start', id: 'text-1' });
              controller.enqueue({
                type: 'text-delta',
                id: 'text-1',
                delta: 'partial',
              });
              providerStarted.resolve();
              // Deliberately remain open with the next provider read pending.
            },
            cancel() {
              providerCancelled.resolve();
            },
          }),
        }),
      }),
      prompt: 'test-input',
      abortSignal: abortController.signal,
      onAbort,
      onEnd,
      onError,
    });

    const streamPartsPromise = (async () => {
      const parts = [];
      for await (const part of result.stream) {
        parts.push(part);
      }
      return parts;
    })();

    // finishReason, rawFinishReason, usage, steps, and the internal initial
    // response-message promise are the root settlement promises. text,
    // finalStep, output, and responseMessages exercise representative derived
    // getters that depend on those roots.
    const outcomesPromise = Promise.all([
      settleWithin(result.finishReason),
      settleWithin(result.rawFinishReason),
      settleWithin(result.usage),
      settleWithin(result.steps),
      settleWithin(result.text),
      settleWithin(result.finalStep),
      settleWithin(result.output),
      settleWithin(result.responseMessages),
    ]);

    await providerStarted.promise;
    abortController.abort(abortReason);

    for (const outcome of await outcomesPromise) {
      expectAbortRejection(outcome, abortReason.message);
    }

    const parts = await streamPartsPromise;
    expect(parts.filter(part => part.type === 'abort')).toHaveLength(1);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledWith(
      expect.objectContaining({ reason: abortReason }),
    );
    expect(onEnd).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(await settleWithin(providerCancelled.promise)).toMatchObject({
      status: 'resolved',
    });
  });

  it('settles a pre-aborted operation without waiting for provider output', async () => {
    const abortController = new AbortController();
    const abortReason = new DOMException('already stopped', 'AbortError');
    const onAbort = vi.fn();
    const onEnd = vi.fn();
    const onError = vi.fn();

    abortController.abort(abortReason);

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.close();
            },
          }),
        }),
      }),
      prompt: 'test-input',
      abortSignal: abortController.signal,
      onAbort,
      onEnd,
      onError,
    });

    const partsPromise = (async () => {
      const parts = [];
      for await (const part of result.stream) {
        parts.push(part);
      }
      return parts;
    })();

    expectAbortRejection(await settleWithin(result.steps), abortReason.message);

    const parts = await partsPromise;
    expect(parts.filter(part => part.type === 'abort')).toHaveLength(1);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledWith(
      expect.objectContaining({ reason: abortReason }),
    );
    expect(onEnd).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('delivers explicit abort to an active local tool and does not report normal completion', async () => {
    const abortController = new AbortController();
    const abortReason = new DOMException('stop active tool', 'AbortError');
    const toolStarted = deferred<void>();
    const toolObservedAbort = deferred<unknown>();
    const onAbort = vi.fn();
    const onEnd = vi.fn();
    const onError = vi.fn();

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'call-1',
                toolName: 'delayedTool',
                input: '{}',
              });
              controller.enqueue({
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
                usage: testUsage,
              });
              controller.close();
            },
          }),
        }),
      }),
      prompt: 'test-input',
      abortSignal: abortController.signal,
      tools: {
        delayedTool: tool({
          inputSchema: z.object({}),
          execute: async (_input, { abortSignal }) => {
            toolStarted.resolve();

            await new Promise<never>((_resolve, reject) => {
              const rejectFromAbort = () => {
                const reason =
                  abortSignal?.reason ??
                  new DOMException('This operation was aborted', 'AbortError');
                toolObservedAbort.resolve(reason);
                reject(reason);
              };

              if (abortSignal?.aborted) {
                rejectFromAbort();
                return;
              }

              abortSignal?.addEventListener('abort', rejectFromAbort, {
                once: true,
              });
            });
          },
        }),
      },
      onAbort,
      onEnd,
      onError,
    });

    const streamPartsPromise = (async () => {
      const parts = [];
      for await (const part of result.stream) {
        parts.push(part);
      }
      return parts;
    })();

    const textOutcomePromise = settleWithin(result.text);
    const stepsOutcomePromise = settleWithin(result.steps);

    await toolStarted.promise;
    abortController.abort(abortReason);

    expect(await settleWithin(toolObservedAbort.promise)).toMatchObject({
      status: 'resolved',
      value: abortReason,
    });
    expectAbortRejection(await textOutcomePromise, abortReason.message);
    expectAbortRejection(await stepsOutcomePromise, abortReason.message);

    const parts = await streamPartsPromise;
    expect(parts.filter(part => part.type === 'abort')).toHaveLength(1);
    expect(parts.some(part => part.type === 'tool-result')).toBe(false);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

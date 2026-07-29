import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from '../test/mock-language-model-v4';
import { streamText } from './stream-text';

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

function expectSameRejection(
  outcome: Awaited<ReturnType<typeof settleWithin>>,
  expectedError: Error,
) {
  expect(outcome.status).toBe('rejected');
  if (outcome.status === 'rejected') {
    expect(outcome.error).toBe(expectedError);
  }
}

describe('streamText provider error terminal settlement', () => {
  it('rejects the outward stream and every aggregate result with the same provider error', async () => {
    const providerError = new DOMException(
      'provider body timed out',
      'TimeoutError',
    );
    const onEnd = vi.fn();

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
              controller.error(providerError);
            },
          }),
        }),
      }),
      prompt: 'test-input',
      onError: () => {},
      onEnd,
    });

    const streamOutcomePromise = settleWithin(
      (async () => {
        for await (const _part of result.stream) {
          // Consume until the provider error terminates the stream.
        }
      })(),
    );

    const outcomes = await Promise.all([
      settleWithin(result.text),
      settleWithin(result.steps),
      settleWithin(result.finishReason),
      settleWithin(result.rawFinishReason),
      settleWithin(result.usage),
      settleWithin(result.responseMessages),
    ]);

    for (const outcome of outcomes) {
      expectSameRejection(outcome, providerError);
    }
    expectSameRejection(await streamOutcomePromise, providerError);
    expect(onEnd).not.toHaveBeenCalled();
  });
});

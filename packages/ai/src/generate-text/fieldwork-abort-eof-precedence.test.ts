import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { convertAsyncIterableToArray } from '@ai-sdk/provider-utils/test';
import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from '../test/mock-language-model-v4';
import { streamText } from './stream-text';

function partialStream({
  onAbort,
}: {
  onAbort?: (controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>) => void;
}) {
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: 'text-1' });
          controller.enqueue({
            type: 'text-delta',
            id: 'text-1',
            delta: 'partial',
          });

          abortSignal?.addEventListener(
            'abort',
            () => onAbort?.(controller),
            { once: true },
          );
        },
      }),
    }),
  });
}

describe('Fieldwork #902: abort versus clean EOF precedence', () => {
  it('currently lets clean EOF mask caller abort after partial output', async () => {
    const abortController = new AbortController();
    const onAbort = vi.fn();
    let providerObservedAbort = false;

    const result = streamText({
      model: partialStream({
        onAbort(controller) {
          providerObservedAbort = true;
          controller.close();
        },
      }),
      prompt: 'stream partial output then abort',
      abortSignal: abortController.signal,
      onAbort,
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          abortController.abort(new DOMException('caller abort', 'AbortError'));
        }
      },
    });

    const parts = await convertAsyncIterableToArray(result.fullStream);

    expect(providerObservedAbort).toBe(true);
    expect(parts.some(part => part.type === 'abort')).toBe(false);
    expect(onAbort).not.toHaveBeenCalled();
    expect(await result.text).toBe('partial');
    expect(await result.finishReason).toBe('other');
    expect(await result.steps).toHaveLength(1);
    expect((await result.steps)[0].finishReason).toBe('other');
  });

  it('emits abort when a post-abort provider chunk makes the read non-terminal', async () => {
    const abortController = new AbortController();
    const onAbort = vi.fn();

    const result = streamText({
      model: partialStream({
        onAbort(controller) {
          controller.enqueue({
            type: 'text-delta',
            id: 'text-1',
            delta: 'late',
          });
        },
      }),
      prompt: 'stream partial output then abort',
      abortSignal: abortController.signal,
      onAbort,
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          abortController.abort(new DOMException('caller abort', 'AbortError'));
        }
      },
    });

    const parts = await convertAsyncIterableToArray(result.fullStream);

    expect(parts.some(part => part.type === 'abort')).toBe(true);
    expect(onAbort).toHaveBeenCalledOnce();
  });

  it('retains partial output on natural clean EOF without caller abort', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 'text-1' });
            controller.enqueue({
              type: 'text-delta',
              id: 'text-1',
              delta: 'partial',
            });
            controller.close();
          },
        }),
      }),
    });

    const onAbort = vi.fn();
    const result = streamText({
      model,
      prompt: 'natural partial EOF',
      onAbort,
    });

    const parts = await convertAsyncIterableToArray(result.fullStream);

    expect(parts.some(part => part.type === 'abort')).toBe(false);
    expect(onAbort).not.toHaveBeenCalled();
    expect(await result.text).toBe('partial');
    expect(await result.finishReason).toBe('other');
  });
});

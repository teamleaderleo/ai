import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { describe, expect, it } from 'vitest';
import type { UIMessage } from '../ui/ui-messages';
import { createUIMessageStream } from './create-ui-message-stream';

const throwingOnError = () => {
  throw new Error('formatter failed');
};

async function readWithTimeout<T>(
  stream: ReadableStream<T>,
  timeoutMs = 1000,
): Promise<T[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      convertReadableStreamToArray(stream),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('UI message stream did not close')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout != null) {
      clearTimeout(timeout);
    }
  }
}

describe('createUIMessageStream error formatting', () => {
  it('falls back and closes when synchronous execute error formatting throws', async () => {
    const stream = createUIMessageStream<UIMessage>({
      execute: () => {
        throw new Error('execute failed');
      },
      onError: throwingOnError,
    });

    await expect(readWithTimeout(stream)).resolves.toEqual([
      { type: 'error', errorText: 'An error occurred.' },
    ]);
  });

  it('falls back and closes when asynchronous execute error formatting throws', async () => {
    const stream = createUIMessageStream<UIMessage>({
      execute: async () => {
        throw new Error('execute failed');
      },
      onError: throwingOnError,
      onEnd: () => {},
    });

    await expect(readWithTimeout(stream)).resolves.toEqual([
      { type: 'error', errorText: 'An error occurred.' },
    ]);
  });

  it('falls back and closes when merged stream error formatting throws', async () => {
    const stream = createUIMessageStream<UIMessage>({
      execute: ({ writer }) => {
        writer.merge(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('merged stream failed'));
            },
          }),
        );
      },
      onError: throwingOnError,
    });

    await expect(readWithTimeout(stream)).resolves.toEqual([
      { type: 'error', errorText: 'An error occurred.' },
    ]);
  });
});

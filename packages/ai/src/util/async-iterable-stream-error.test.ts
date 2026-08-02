import { describe, expect, it } from 'vitest';
import {
  asAsyncIterableStream,
  createAsyncIterableStream,
} from './async-iterable-stream';

describe('asAsyncIterableStream() source errors', () => {
  it('releases the reader lock and preserves the source error', async () => {
    const sourceError = new Error('source failed');
    let controller: ReadableStreamDefaultController<string>;
    let cancelCalls = 0;

    const stream = asAsyncIterableStream(
      new ReadableStream<string>({
        start(value) {
          controller = value;
        },
        cancel() {
          cancelCalls++;
        },
      }),
    );
    const iterator = stream[Symbol.asyncIterator]();

    expect(stream.locked).toBe(true);

    controller.error(sourceError);

    await expect(iterator.next()).rejects.toBe(sourceError);
    expect(stream.locked).toBe(false);
    expect(cancelCalls).toBe(0);
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it('releases the reader lock after yielding earlier chunks', async () => {
    const sourceError = new Error('source failed after data');
    let controller: ReadableStreamDefaultController<string>;

    const stream = asAsyncIterableStream(
      new ReadableStream<string>({
        start(value) {
          controller = value;
          value.enqueue('chunk');
        },
      }),
    );
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: 'chunk',
    });
    expect(stream.locked).toBe(true);

    controller.error(sourceError);

    await expect(iterator.next()).rejects.toBe(sourceError);
    expect(stream.locked).toBe(false);
  });
});

describe('createAsyncIterableStream() source errors', () => {
  it('releases the wrapped stream lock and preserves the source error', async () => {
    const sourceError = new Error('wrapped source failed');
    let controller: ReadableStreamDefaultController<string>;

    const stream = createAsyncIterableStream(
      new ReadableStream<string>({
        start(value) {
          controller = value;
        },
      }),
    );
    const iterator = stream[Symbol.asyncIterator]();

    expect(stream.locked).toBe(true);

    controller.error(sourceError);

    await expect(iterator.next()).rejects.toBe(sourceError);
    expect(stream.locked).toBe(false);
  });
});

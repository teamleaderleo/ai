import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { expect, it } from 'vitest';
import { createStitchableStream } from './create-stitchable-stream';

it('should release a completed inner stream reader', async () => {
  const source = new ReadableStream<number>({
    start(controller) {
      controller.enqueue(1);
      controller.close();
    },
  });
  const { stream, addStream, close } = createStitchableStream<number>();

  addStream(source);
  close();

  expect(await convertReadableStreamToArray(stream)).toEqual([1]);
  expect(source.locked).toBe(false);

  const reader = source.getReader();
  reader.releaseLock();
});

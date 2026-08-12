import { describe, expect, it } from 'vitest';
import { MockImageModelV4 } from '../test/mock-image-model-v4';
import { generateImage } from './generate-image';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const imageResult = () => ({
  images: ['AAAA'],
  warnings: [],
  providerMetadata: {},
  response: {
    timestamp: new Date(0),
    modelId: 'fanout-model',
    headers: {},
  },
});

describe('Fieldwork #868: generateImage fanout failure ownership', () => {
  it('lets a sibling model call continue after the aggregate promise rejects', async () => {
    const bothStarted = deferred<void>();
    const failFirst = deferred<void>();
    const releaseSibling = deferred<void>();
    const siblingFinished = deferred<void>();
    const failure = new Error('first image child failed');
    let started = 0;
    let siblingCompleted = false;

    const result = generateImage({
      model: new MockImageModelV4({
        maxImagesPerCall: 1,
        doGenerate: async () => {
          const childIndex = started++;
          if (started === 2) {
            bothStarted.resolve();
          }

          await bothStarted.promise;

          if (childIndex === 0) {
            await failFirst.promise;
            throw failure;
          }

          await releaseSibling.promise;
          siblingCompleted = true;
          siblingFinished.resolve();
          return imageResult();
        },
      }),
      prompt: 'fanout ownership',
      n: 2,
      maxRetries: 0,
    });

    await bothStarted.promise;
    failFirst.resolve();

    await expect(result).rejects.toBe(failure);
    expect(siblingCompleted).toBe(false);

    releaseSibling.resolve();
    await siblingFinished.promise;

    expect(siblingCompleted).toBe(true);
  });
});

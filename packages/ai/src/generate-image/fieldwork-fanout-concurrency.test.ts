import { describe, expect, it } from 'vitest';
import { MockImageModelV4 } from '../test/mock-image-model-v4';
import { generateImage } from './generate-image';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const imageResult = () => ({
  images: ['AAAA'],
  warnings: [],
  providerMetadata: {},
  response: {
    timestamp: new Date(0),
    modelId: 'fanout-concurrency-model',
    headers: {},
  },
});

describe('Fieldwork #873: generateImage fanout concurrency', () => {
  it('starts every required one-image child before any child settles', async () => {
    const releaseChildren = deferred();
    const allChildrenStarted = deferred();
    let activeChildren = 0;
    let peakChildren = 0;
    let startedChildren = 0;

    const result = generateImage({
      model: new MockImageModelV4({
        maxImagesPerCall: 1,
        doGenerate: async () => {
          startedChildren++;
          activeChildren++;
          peakChildren = Math.max(peakChildren, activeChildren);

          if (startedChildren === 25) {
            allChildrenStarted.resolve();
          }

          await releaseChildren.promise;
          activeChildren--;
          return imageResult();
        },
      }),
      prompt: 'fanout concurrency',
      n: 25,
      maxRetries: 0,
    });

    await allChildrenStarted.promise;

    expect(startedChildren).toBe(25);
    expect(peakChildren).toBe(25);
    expect(activeChildren).toBe(25);

    releaseChildren.resolve();

    const generated = await result;
    expect(generated.images).toHaveLength(25);
    expect(activeChildren).toBe(0);
  });
});

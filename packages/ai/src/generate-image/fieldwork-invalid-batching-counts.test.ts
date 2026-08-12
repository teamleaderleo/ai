import { describe, expect, it, vi } from 'vitest';
import { NoImageGeneratedError } from '../error/no-image-generated-error';
import { MockImageModelV4 } from '../test/mock-image-model-v4';
import { generateImage } from './generate-image';

const imageResult = () => ({
  images: ['AAAA'],
  warnings: [],
  providerMetadata: {},
  response: {
    timestamp: new Date(0),
    modelId: 'invalid-count-model',
    headers: {},
  },
});

describe('Fieldwork #876: generateImage batching count domain', () => {
  it.each([0, -1])(
    'turns n=%s into a no-image result without calling the model',
    async n => {
      const doGenerate = vi.fn(async () => imageResult());

      await expect(
        generateImage({
          model: new MockImageModelV4({
            maxImagesPerCall: 1,
            doGenerate,
          }),
          prompt: 'invalid count',
          n,
          maxRetries: 0,
        }),
      ).rejects.toBeInstanceOf(NoImageGeneratedError);

      expect(doGenerate).not.toHaveBeenCalled();
    },
  );

  it('forwards a fractional final child count when n is fractional', async () => {
    const observedCounts: number[] = [];

    await generateImage({
      model: new MockImageModelV4({
        maxImagesPerCall: 1,
        doGenerate: async ({ n }) => {
          observedCounts.push(n);
          return imageResult();
        },
      }),
      prompt: 'fractional requested count',
      n: 1.5,
      maxRetries: 0,
    });

    expect(observedCounts).toEqual([1, 0.5]);
  });

  it('fails through low-level array sizing when maxImagesPerCall is zero', async () => {
    const doGenerate = vi.fn(async () => imageResult());

    await expect(
      generateImage({
        model: new MockImageModelV4({ doGenerate }),
        prompt: 'zero per-call maximum',
        n: 1,
        maxImagesPerCall: 0,
        maxRetries: 0,
      }),
    ).rejects.toBeInstanceOf(RangeError);

    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('turns a negative maxImagesPerCall into a no-image result', async () => {
    const doGenerate = vi.fn(async () => imageResult());

    await expect(
      generateImage({
        model: new MockImageModelV4({ doGenerate }),
        prompt: 'negative per-call maximum',
        n: 1,
        maxImagesPerCall: -1,
        maxRetries: 0,
      }),
    ).rejects.toBeInstanceOf(NoImageGeneratedError);

    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('forwards fractional child counts from a fractional per-call maximum', async () => {
    const observedCounts: number[] = [];

    await generateImage({
      model: new MockImageModelV4({
        doGenerate: async ({ n }) => {
          observedCounts.push(n);
          return imageResult();
        },
      }),
      prompt: 'fractional per-call maximum',
      n: 3,
      maxImagesPerCall: 1.5,
      maxRetries: 0,
    });

    expect(observedCounts).toEqual([1.5, 1.5]);
  });
});

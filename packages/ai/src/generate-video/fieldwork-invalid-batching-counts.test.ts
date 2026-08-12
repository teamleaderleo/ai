import { describe, expect, it, vi } from 'vitest';
import { NoVideoGeneratedError } from '../error/no-video-generated-error';
import { MockVideoModelV4 } from '../test/mock-video-model-v4';
import { experimental_generateVideo } from './generate-video';

const videoResult = () => ({
  videos: [
    {
      type: 'base64' as const,
      data: 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=',
      mediaType: 'video/mp4',
    },
  ],
  warnings: [],
  providerMetadata: {},
  response: {
    timestamp: new Date(0),
    modelId: 'invalid-count-model',
    headers: {},
  },
});

describe('Fieldwork #876: generateVideo batching count domain', () => {
  it.each([0, -1])(
    'turns n=%s into a no-video result without calling the model',
    async n => {
      const doGenerate = vi.fn(async () => videoResult());

      await expect(
        experimental_generateVideo({
          model: new MockVideoModelV4({
            maxVideosPerCall: 1,
            doGenerate,
          }),
          prompt: 'invalid count',
          n,
          maxRetries: 0,
        }),
      ).rejects.toBeInstanceOf(NoVideoGeneratedError);

      expect(doGenerate).not.toHaveBeenCalled();
    },
  );

  it('forwards a fractional final child count when n is fractional', async () => {
    const observedCounts: number[] = [];

    await experimental_generateVideo({
      model: new MockVideoModelV4({
        maxVideosPerCall: 1,
        doGenerate: async ({ n }) => {
          observedCounts.push(n);
          return videoResult();
        },
      }),
      prompt: 'fractional requested count',
      n: 1.5,
      maxRetries: 0,
    });

    expect(observedCounts).toEqual([1, 0.5]);
  });

  it('fails through low-level array sizing when maxVideosPerCall is zero', async () => {
    const doGenerate = vi.fn(async () => videoResult());

    await expect(
      experimental_generateVideo({
        model: new MockVideoModelV4({ doGenerate }),
        prompt: 'zero per-call maximum',
        n: 1,
        maxVideosPerCall: 0,
        maxRetries: 0,
      }),
    ).rejects.toBeInstanceOf(RangeError);

    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('turns a negative maxVideosPerCall into a no-video result', async () => {
    const doGenerate = vi.fn(async () => videoResult());

    await expect(
      experimental_generateVideo({
        model: new MockVideoModelV4({ doGenerate }),
        prompt: 'negative per-call maximum',
        n: 1,
        maxVideosPerCall: -1,
        maxRetries: 0,
      }),
    ).rejects.toBeInstanceOf(NoVideoGeneratedError);

    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('forwards fractional child counts from a fractional per-call maximum', async () => {
    const observedCounts: number[] = [];

    await experimental_generateVideo({
      model: new MockVideoModelV4({
        doGenerate: async ({ n }) => {
          observedCounts.push(n);
          return videoResult();
        },
      }),
      prompt: 'fractional per-call maximum',
      n: 3,
      maxVideosPerCall: 1.5,
      maxRetries: 0,
    });

    expect(observedCounts).toEqual([1.5, 1.5]);
  });
});

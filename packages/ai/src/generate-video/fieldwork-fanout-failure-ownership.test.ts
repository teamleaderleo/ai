import { describe, expect, it } from 'vitest';
import { MockVideoModelV4 } from '../test/mock-video-model-v4';
import { experimental_generateVideo } from './generate-video';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const startResult = (operation: string) => ({
  operation,
  warnings: [],
  response: {
    timestamp: new Date(0),
    modelId: 'fanout-model',
    headers: {},
  },
});

const completedStatus = () => ({
  status: 'completed' as const,
  videos: [
    {
      type: 'base64' as const,
      data: 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=',
      mediaType: 'video/mp4',
    },
  ],
  warnings: [],
  response: {
    timestamp: new Date(0),
    modelId: 'fanout-model',
    headers: {},
  },
});

describe('Fieldwork #868: generateVideo fanout failure ownership', () => {
  it('lets a sibling status flow continue after the aggregate promise rejects', async () => {
    const bothStatusesStarted = deferred();
    const failFirst = deferred();
    const releaseSibling = deferred();
    const siblingFinished = deferred();
    let startCount = 0;
    let statusCount = 0;
    let siblingCompleted = false;

    const result = experimental_generateVideo({
      model: new MockVideoModelV4({
        maxVideosPerCall: 1,
        doGenerate: undefined,
        doStart: async () => startResult(`operation-${startCount++}`),
        doStatus: async ({ operation }) => {
          statusCount++;
          if (statusCount === 2) {
            bothStatusesStarted.resolve();
          }

          await bothStatusesStarted.promise;

          if (operation === 'operation-0') {
            await failFirst.promise;
            return {
              status: 'error' as const,
              error: 'first video child failed',
              response: {
                timestamp: new Date(0),
                modelId: 'fanout-model',
                headers: {},
              },
            };
          }

          await releaseSibling.promise;
          siblingCompleted = true;
          siblingFinished.resolve();
          return completedStatus();
        },
      }),
      prompt: 'fanout ownership',
      n: 2,
      maxRetries: 0,
      poll: {
        intervalMs: 0,
        timeoutMs: 10_000,
        delay: async () => {},
      },
    });

    await bothStatusesStarted.promise;
    failFirst.resolve();

    await expect(result).rejects.toThrow('first video child failed');
    expect(siblingCompleted).toBe(false);

    releaseSibling.resolve();
    await siblingFinished.promise;

    expect(siblingCompleted).toBe(true);
  });
});

import { APICallError } from '@ai-sdk/provider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockVideoModelV4 } from '../test/mock-video-model-v4';
import { experimental_generateVideo } from './generate-video';

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
    modelId: 'research-model',
    headers: {},
  },
});

const startResult = () => ({
  operation: { id: 'research-operation' },
  warnings: [],
  response: {
    timestamp: new Date(0),
    modelId: 'research-model',
    headers: {},
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateVideo polling deadline authority', () => {
  it('does not publish a polling result returned after timeoutMs', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    let markStatusStarted!: () => void;
    const statusStarted = new Promise<void>(resolve => {
      markStatusStarted = resolve;
    });
    let resolveStatus!: (value: ReturnType<typeof completedStatus>) => void;
    const status = new Promise<ReturnType<typeof completedStatus>>(resolve => {
      resolveStatus = resolve;
    });

    const result = experimental_generateVideo({
      model: new MockVideoModelV4({
        doGenerate: undefined,
        doStart: async () => startResult(),
        doStatus: async () => {
          markStatusStarted();
          return status;
        },
      }),
      prompt: 'deadline test',
      poll: {
        intervalMs: 0,
        timeoutMs: 5,
        delay: async () => {},
      },
    });

    await statusStarted;
    now = 6;
    resolveStatus(completedStatus());

    await expect(result).rejects.toThrow(
      'Video generation timed out after 5ms.',
    );
  });

  it(
    'keeps the deadline authoritative after a webhook notification',
    async () => {
      let now = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => now);

      let markStatusStarted!: () => void;
      const statusStarted = new Promise<void>(resolve => {
        markStatusStarted = resolve;
      });
      let resolveStatus!: (value: ReturnType<typeof completedStatus>) => void;
      const status = new Promise<ReturnType<typeof completedStatus>>(resolve => {
        resolveStatus = resolve;
      });

      const result = experimental_generateVideo({
        model: new MockVideoModelV4({
          doGenerate: undefined,
          handleWebhookOption: async ({ webhook }) => {
            const { url, received } = await webhook();
            return { webhookUrl: url, received };
          },
          doStart: async () => startResult(),
          doStatus: async () => {
            markStatusStarted();
            return status;
          },
        }),
        prompt: 'webhook deadline test',
        poll: {
          timeoutMs: 5,
          delay: () => new Promise<void>(() => {}),
        },
        webhook: async () => ({
          url: 'https://example.test/webhook',
          received: Promise.resolve({ headers: {}, body: {} }),
        }),
      });

      await statusStarted;
      now = 6;
      resolveStatus(completedStatus());

      await expect(result).rejects.toThrow(
        'Video generation timed out after 5ms.',
      );
    },
  );

  it(
    'does not let a status retry publish success after the deadline',
    async () => {
      let now = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => now);

      let markFirstAttempt!: () => void;
      const firstAttempt = new Promise<void>(resolve => {
        markFirstAttempt = resolve;
      });
      let attempts = 0;

      const result = experimental_generateVideo({
        model: new MockVideoModelV4({
          doGenerate: undefined,
          doStart: async () => startResult(),
          doStatus: async () => {
            attempts++;
            if (attempts === 1) {
              markFirstAttempt();
              throw new APICallError({
                message: 'temporary status failure',
                url: 'https://example.test/status',
                requestBodyValues: {},
                statusCode: 500,
                responseHeaders: { 'retry-after-ms': '10' },
              });
            }
            return completedStatus();
          },
        }),
        prompt: 'retry deadline test',
        maxRetries: 1,
        poll: {
          intervalMs: 0,
          timeoutMs: 5,
          delay: async () => {},
        },
      });

      await firstAttempt;
      now = 6;

      await expect(result).rejects.toThrow(
        'Video generation timed out after 5ms.',
      );
      expect(attempts).toBe(1);
    },
  );

  it('settles at timeoutMs when a status transport never settles', async () => {
    const result = experimental_generateVideo({
      model: new MockVideoModelV4({
        doGenerate: undefined,
        doStart: async () => startResult(),
        doStatus: () => new Promise<never>(() => {}),
      }),
      prompt: 'never settling status test',
      poll: {
        intervalMs: 0,
        timeoutMs: 10,
        delay: async () => {},
      },
    });

    const outcome = await Promise.race([
      result.then(
        () => 'resolved',
        error => `rejected:${error instanceof Error ? error.message : error}`,
      ),
      new Promise<string>(resolve => {
        setTimeout(() => resolve('watchdog'), 50);
      }),
    ]);

    expect(outcome).toBe('rejected:Video generation timed out after 10ms.');
  });
});

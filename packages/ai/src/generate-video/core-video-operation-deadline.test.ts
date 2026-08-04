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
    modelId: 'deadline-model',
    headers: {},
  },
});

const startResult = () => ({
  operation: { id: 'deadline-operation' },
  warnings: [],
  response: {
    timestamp: new Date(0),
    modelId: 'deadline-model',
    headers: {},
  },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('generateVideo operation deadline', () => {
  it('rejects a completed polling result returned after timeoutMs', async () => {
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

  it('keeps the deadline authoritative after a webhook notification', async () => {
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
  });

  it('does not start another status retry after the deadline', async () => {
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
  });

  it('settles when a status transport ignores abort and never settles', async () => {
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

    await expect(result).rejects.toThrow(
      'Video generation timed out after 10ms.',
    );
  });

  it('preserves caller abort before the operation deadline', async () => {
    const controller = new AbortController();
    let markStatusStarted!: () => void;
    const statusStarted = new Promise<void>(resolve => {
      markStatusStarted = resolve;
    });

    const result = experimental_generateVideo({
      model: new MockVideoModelV4({
        doGenerate: undefined,
        doStart: async () => startResult(),
        doStatus: ({ abortSignal }) =>
          new Promise<never>((_, reject) => {
            markStatusStarted();
            abortSignal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          }),
      }),
      prompt: 'caller abort test',
      abortSignal: controller.signal,
      poll: {
        intervalMs: 0,
        timeoutMs: 1_000,
        delay: async () => {},
      },
    });

    await statusStarted;
    controller.abort();

    await expect(result).rejects.toHaveProperty('name', 'AbortError');
  });

  it('settles locally when AbortController is unavailable', async () => {
    vi.stubGlobal('AbortController', undefined);

    const result = experimental_generateVideo({
      model: new MockVideoModelV4({
        doGenerate: undefined,
        doStart: async () => startResult(),
        doStatus: () => new Promise<never>(() => {}),
      }),
      prompt: 'optional abort controller test',
      poll: {
        intervalMs: 0,
        timeoutMs: 10,
        delay: async () => {},
      },
    });

    await expect(result).rejects.toThrow(
      'Video generation timed out after 10ms.',
    );
  });

  it('passes the caller abort signal unchanged to status calls', async () => {
    const controller = new AbortController();
    let statusSignal: AbortSignal | undefined;

    await experimental_generateVideo({
      model: new MockVideoModelV4({
        doGenerate: undefined,
        doStart: async () => startResult(),
        doStatus: async ({ abortSignal }) => {
          statusSignal = abortSignal;
          return completedStatus();
        },
      }),
      prompt: 'caller signal identity test',
      abortSignal: controller.signal,
      poll: {
        intervalMs: 0,
        timeoutMs: 1_000,
        delay: async () => {},
      },
    });

    expect(statusSignal).toBe(controller.signal);
  });

  it('stops retry scheduling at the deadline while preserving the caller signal', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const controller = new AbortController();
    let markFirstAttempt!: () => void;
    const firstAttempt = new Promise<void>(resolve => {
      markFirstAttempt = resolve;
    });
    const statusSignals: Array<AbortSignal | undefined> = [];
    let attempts = 0;

    const result = experimental_generateVideo({
      model: new MockVideoModelV4({
        doGenerate: undefined,
        doStart: async () => startResult(),
        doStatus: async ({ abortSignal }) => {
          statusSignals.push(abortSignal);
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
      prompt: 'caller signal retry deadline test',
      abortSignal: controller.signal,
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
    expect(statusSignals).toEqual([controller.signal]);
  });

  it('aborts a cooperative webhook delay when the wall-clock deadline wins', async () => {
    let markDelayStarted!: () => void;
    const delayStarted = new Promise<void>(resolve => {
      markDelayStarted = resolve;
    });
    let markDelayAborted!: () => void;
    const delayAborted = new Promise<void>(resolve => {
      markDelayAborted = resolve;
    });

    const result = experimental_generateVideo({
      model: new MockVideoModelV4({
        doGenerate: undefined,
        handleWebhookOption: async ({ webhook }) => {
          const { url, received } = await webhook();
          return { webhookUrl: url, received };
        },
        doStart: async () => startResult(),
        doStatus: async () => completedStatus(),
      }),
      prompt: 'webhook cleanup deadline test',
      poll: {
        timeoutMs: 10,
        delay: (_delayInMs, { abortSignal } = {}) =>
          new Promise<void>((_resolve, reject) => {
            markDelayStarted();
            const rejectForAbort = () => {
              markDelayAborted();
              reject(
                abortSignal?.reason ??
                  new DOMException('Aborted', 'AbortError'),
              );
            };
            if (abortSignal?.aborted) {
              rejectForAbort();
              return;
            }
            abortSignal?.addEventListener('abort', rejectForAbort, {
              once: true,
            });
          }),
      },
      webhook: async () => ({
        url: 'https://example.test/webhook',
        received: new Promise<never>(() => {}),
      }),
    });

    await delayStarted;
    await expect(result).rejects.toThrow(
      'Video generation timed out after 10ms.',
    );
    await delayAborted;
  });

  it('preserves caller abort when a status transport ignores its signal', async () => {
    const controller = new AbortController();
    const callerReason = new DOMException('Caller stopped', 'AbortError');
    let markStatusStarted!: () => void;
    const statusStarted = new Promise<void>(resolve => {
      markStatusStarted = resolve;
    });

    const result = experimental_generateVideo({
      model: new MockVideoModelV4({
        doGenerate: undefined,
        doStart: async () => startResult(),
        doStatus: () => {
          markStatusStarted();
          return new Promise<never>(() => {});
        },
      }),
      prompt: 'caller abort ignored transport test',
      abortSignal: controller.signal,
      poll: {
        intervalMs: 0,
        timeoutMs: 1_000,
        delay: async () => {},
      },
    });

    await statusStarted;
    controller.abort(callerReason);

    await expect(result).rejects.toBe(callerReason);
  });
});

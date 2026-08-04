from pathlib import Path

SOURCE_PATH = Path('packages/ai/src/generate-video/generate-video.ts')
TEST_PATH = Path(
    'packages/ai/src/generate-video/core-video-operation-deadline.test.ts'
)
CHANGESET_PATH = Path('.changeset/quiet-snails-own.md')

source = SOURCE_PATH.read_text()

old_retry_setup = """  const { retry } = prepareRetries({
    maxRetries: maxRetriesArg,
    abortSignal,
  });"""
new_retry_setup = """  const { maxRetries, retry } = prepareRetries({
    maxRetries: maxRetriesArg,
    abortSignal,
  });"""
if old_retry_setup in source:
    source = source.replace(old_retry_setup, new_retry_setup, 1)
elif new_retry_setup not in source:
    raise SystemExit('prepareRetries setup no longer matches the pinned base')

old_flow_call = """          webhook,
          retry,
        });"""
new_flow_call = """          webhook,
          retry,
          maxRetries,
        });"""
if old_flow_call in source:
    source = source.replace(old_flow_call, new_flow_call, 1)
elif new_flow_call not in source:
    raise SystemExit('executeStartStatusFlow call no longer matches the pinned base')

flow_start = source.index('async function executeStartStatusFlow({')
flow_end = source.index('async function waitForWebhook({', flow_start)
flow_and_deadline = r'''async function executeStartStatusFlow({
  model,
  callOptions,
  poll: pollConfig,
  webhook: webhookFactory,
  retry,
  maxRetries,
}: {
  model: Experimental_VideoModelV4;
  callOptions: Experimental_VideoModelV4CallOptions;
  poll?: GenerateVideoPollOptions;
  webhook?: GenerateVideoWebhookFactory;
  retry: <OUTPUT>(fn: () => PromiseLike<OUTPUT>) => PromiseLike<OUTPUT>;
  maxRetries: number;
}): Promise<Experimental_VideoModelV4Result> {
  // 1. If webhook and provider supports it, set up the webhook
  const earlyWarnings: Experimental_VideoModelV4Result['warnings'] = [];
  let webhookUrl: string | undefined;
  let webhookReceived:
    | PromiseLike<Experimental_VideoModelV4OperationWebhook>
    | undefined;

  if (webhookFactory != null) {
    if (model.handleWebhookOption != null) {
      const result = await model.handleWebhookOption({
        webhook: webhookFactory,
      });
      webhookUrl = result.webhookUrl;
      webhookReceived = result.received;
    } else {
      earlyWarnings.push({
        type: 'unsupported',
        feature: 'webhook',
        details:
          'This model does not support webhooks. Falling back to polling.',
      });
    }
  }

  // 2. Start the generation. The local operation deadline begins only after
  // the provider has accepted the remote job.
  const startResult = await retry(() =>
    model.doStart!({
      ...callOptions,
      webhookUrl,
    }),
  );

  const allWarnings = [...earlyWarnings, ...startResult.warnings];
  let operationProviderMetadata =
    startResult.providerMetadata == null
      ? undefined
      : { ...startResult.providerMetadata };
  const intervalMs = pollConfig?.intervalMs ?? 5000;
  const timeoutMs = pollConfig?.timeoutMs ?? 600_000;
  const delay = pollConfig?.delay ?? defaultDelay;
  const startTime = Date.now();
  const deadline = createOperationDeadline({
    timeoutMs,
    abortSignal: callOptions.abortSignal,
    startTime,
  });
  const { retry: retryStatus } = prepareRetries({
    maxRetries,
    abortSignal: deadline.signal,
  });

  try {
    if (webhookReceived != null) {
      // 3a. Webhook flow: bound both notification receipt and final status.
      await deadline.race(
        waitForWebhook({
          received: webhookReceived,
          timeoutMs,
          abortSignal: deadline.signal,
          delay,
        }),
      );
    }

    while (true) {
      if (webhookReceived == null) {
        // 3b. Polling flow (also used when webhooks are not supported).
        const elapsedMs = Date.now() - startTime;
        deadline.assertActive();
        await deadline.race(
          delay(Math.min(intervalMs, Math.max(0, timeoutMs - elapsedMs)), {
            abortSignal: deadline.signal,
          }),
        );
        deadline.assertActive();
      }

      deadline.assertActive();
      const statusResult = await deadline.race(
        retryStatus(() =>
          model.doStatus!({
            operation: startResult.operation,
            abortSignal: deadline.signal,
            headers: callOptions.headers,
          }),
        ),
      );
      deadline.assertActive();

      if (statusResult.status === 'error') {
        throw new Error(statusResult.error);
      }

      if (statusResult.warnings != null) {
        allWarnings.push(...statusResult.warnings);
      }
      if (statusResult.providerMetadata != null) {
        operationProviderMetadata ??= {};
        mergeProviderMetadata(
          operationProviderMetadata,
          statusResult.providerMetadata,
        );
      }

      if (statusResult.status === 'completed') {
        return {
          videos: statusResult.videos,
          warnings: allWarnings,
          providerMetadata: operationProviderMetadata,
          response: statusResult.response,
        };
      }

      if (webhookReceived != null) {
        throw new Error(
          'Video generation did not complete after webhook notification.',
        );
      }
    }
  } finally {
    deadline.dispose();
  }
}

function createOperationDeadline({
  timeoutMs,
  abortSignal,
  startTime,
}: {
  timeoutMs: number;
  abortSignal?: AbortSignal;
  startTime: number;
}) {
  const timeoutError = new Error(
    `Video generation timed out after ${timeoutMs}ms.`,
  );
  const deadlineAt = startTime + timeoutMs;
  const deadlineController =
    typeof globalThis.AbortController === 'function'
      ? new globalThis.AbortController()
      : undefined;
  const signal =
    deadlineController == null
      ? abortSignal
      : mergeAbortSignals(abortSignal, deadlineController.signal);
  let expired = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abortDeadline = (): void => {
    expired = true;
    if (deadlineController?.signal.aborted === false) {
      deadlineController.abort(timeoutError);
    }
  };

  const throwTimeout = (): never => {
    abortDeadline();
    throw timeoutError;
  };

  const assertActive = (): void => {
    if (expired || !(Date.now() < deadlineAt)) {
      throwTimeout();
    }
  };

  const timeoutPromise: Promise<never> =
    deadlineAt === Number.POSITIVE_INFINITY
      ? new Promise<never>(() => {})
      : new Promise<never>((_, reject) => {
          const schedule = () => {
            const remainingMs = deadlineAt - Date.now();
            if (!(remainingMs > 0)) {
              abortDeadline();
              reject(timeoutError);
              return;
            }
            timeoutId = setTimeout(
              schedule,
              Math.min(remainingMs, 2_147_483_647),
            );
          };
          schedule();
        });

  // Promise.race adopts losing operations. This handler also covers a
  // zero-duration deadline before the first race is installed.
  void timeoutPromise.catch(() => {});

  return {
    signal,
    assertActive,
    async race<T>(operation: PromiseLike<T>): Promise<T> {
      try {
        const result = await Promise.race([
          Promise.resolve(operation),
          timeoutPromise,
        ]);
        assertActive();
        return result;
      } catch (error) {
        if (expired || !(Date.now() < deadlineAt)) {
          throwTimeout();
        }
        throw error;
      }
    },
    dispose(): void {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
    },
  };
}

'''
source = source[:flow_start] + flow_and_deadline + source[flow_end:]
SOURCE_PATH.write_text(source)

TEST_PATH.write_text(r'''import { APICallError } from '@ai-sdk/provider';
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
});
''')

CHANGESET_PATH.write_text(r'''---
'ai': patch
---

Make async video polling timeouts authoritative across polling delays,
webhook finalization, status requests, retries, and transports that ignore
cancellation.
''')

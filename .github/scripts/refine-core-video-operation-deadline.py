from pathlib import Path

source_path = Path('packages/ai/src/generate-video/generate-video.ts')
test_path = Path(
    'packages/ai/src/generate-video/core-video-operation-deadline.test.ts'
)

source = source_path.read_text()
flow_start = source.index('async function executeStartStatusFlow({')
flow_end = source.index('function mergeProviderMetadata(', flow_start)
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

  // Preserve the provider-facing caller signal when present. When the caller
  // supplies no signal, the local deadline signal enables cooperative
  // cancellation in addition to the authoritative outer race.
  const statusAbortSignal = callOptions.abortSignal ?? deadline.signal;
  const pollingDelayAbortSignal =
    pollConfig?.delay == null ? statusAbortSignal : callOptions.abortSignal;
  const { retry: retryStatus } = prepareRetries({
    maxRetries,
    abortSignal: statusAbortSignal,
  });

  try {
    if (webhookReceived != null) {
      // 3a. Preserve the configured webhook wait implementation while the
      // operation deadline also fences the final status call.
      await deadline.race(
        waitForWebhook({
          received: webhookReceived,
          timeoutMs,
          abortSignal: callOptions.abortSignal,
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
            abortSignal: pollingDelayAbortSignal,
          }),
        );
        deadline.assertActive();
      }

      deadline.assertActive();
      const statusResult = await deadline.race(
        retryStatus(() =>
          model.doStatus!({
            operation: startResult.operation,
            abortSignal: statusAbortSignal,
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
  const signal = abortSignal ?? deadlineController?.signal;
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

async function waitForWebhook({
  received,
  timeoutMs,
  abortSignal,
  delay,
}: {
  received: PromiseLike<Experimental_VideoModelV4OperationWebhook>;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  delay: (
    delayInMs: number,
    options?: { abortSignal?: AbortSignal },
  ) => PromiseLike<void>;
}) {
  const timeoutController =
    typeof globalThis.AbortController === 'function'
      ? new globalThis.AbortController()
      : undefined;
  try {
    await Promise.race([
      received,
      delay(timeoutMs, {
        abortSignal:
          timeoutController == null
            ? abortSignal
            : mergeAbortSignals(abortSignal, timeoutController.signal),
      }).then(() => {
        throw new Error(`Video generation timed out after ${timeoutMs}ms.`);
      }),
    ]);
  } finally {
    timeoutController?.abort();
  }
}

'''
source_path.write_text(source[:flow_start] + flow_and_deadline + source[flow_end:])

test = test_path.read_text()
caller_signal_test = r'''

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
'''
closing = "\n});\n"
if not test.endswith(closing):
    raise SystemExit('focused test closing marker changed')
test = test[: -len(closing)] + caller_signal_test + closing
test_path.write_text(test)

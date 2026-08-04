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
    delay,
  });
  const { retry: retryStatus } = prepareRetries({
    maxRetries,
    abortSignal: deadline.signal,
  });

  try {
    if (webhookReceived != null) {
      // 3a. Webhook flow: the operation deadline owns notification receipt and
      // the final status call.
      await deadline.race(webhookReceived);
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
  delay,
}: {
  timeoutMs: number;
  abortSignal?: AbortSignal;
  startTime: number;
  delay: (
    delayInMs: number,
    options?: { abortSignal?: AbortSignal },
  ) => PromiseLike<void>;
}) {
  const timeoutError = new Error(
    `Video generation timed out after ${timeoutMs}ms.`,
  );
  const deadlineAt = startTime + timeoutMs;
  const deadlineController =
    typeof globalThis.AbortController === 'function'
      ? new globalThis.AbortController()
      : undefined;
  const timeoutController =
    typeof globalThis.AbortController === 'function'
      ? new globalThis.AbortController()
      : undefined;
  const signal =
    deadlineController == null
      ? abortSignal
      : mergeAbortSignals(abortSignal, deadlineController.signal);
  const timeoutSignal =
    timeoutController == null
      ? abortSignal
      : mergeAbortSignals(abortSignal, timeoutController.signal);
  let expired = false;

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
      : Promise.resolve(
          delay(Math.max(0, timeoutMs), {
            abortSignal: timeoutSignal,
          }),
        ).then(() => throwTimeout());

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
      timeoutController?.abort();
    },
  };
}

'''
source_path.write_text(source[:flow_start] + flow_and_deadline + source[flow_end:])

test = test_path.read_text()
test = test.replace("        delay: async () => {},\n", "")
test = test.replace(
    "        delay: () => new Promise<void>(() => {}),\n",
    "",
)
custom_clock_test = r'''

  it('uses the custom delay as the operation deadline clock', async () => {
    let markStatusStarted!: () => void;
    const statusStarted = new Promise<void>(resolve => {
      markStatusStarted = resolve;
    });
    let releaseDeadline!: () => void;
    const deadline = new Promise<void>(resolve => {
      releaseDeadline = resolve;
    });
    const delayCalls: number[] = [];

    const result = experimental_generateVideo({
      model: new MockVideoModelV4({
        doGenerate: undefined,
        doStart: async () => startResult(),
        doStatus: () => {
          markStatusStarted();
          return new Promise<never>(() => {});
        },
      }),
      prompt: 'custom deadline clock test',
      poll: {
        intervalMs: 0,
        timeoutMs: 10,
        delay: delayInMs => {
          delayCalls.push(delayInMs);
          return delayInMs === 0 ? Promise.resolve() : deadline;
        },
      },
    });

    await statusStarted;
    expect(delayCalls).toContain(10);
    releaseDeadline();

    await expect(result).rejects.toThrow(
      'Video generation timed out after 10ms.',
    );
  });
'''
closing = "\n});\n"
if not test.endswith(closing):
    raise SystemExit('focused test closing marker changed')
test = test[: -len(closing)] + custom_clock_test + closing
test_path.write_text(test)

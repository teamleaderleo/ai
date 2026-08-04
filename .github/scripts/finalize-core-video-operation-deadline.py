from pathlib import Path

source_path = Path('packages/ai/src/generate-video/generate-video.ts')
test_path = Path(
    'packages/ai/src/generate-video/core-video-operation-deadline.test.ts'
)

source = source_path.read_text()

signals_old = """  const statusAbortSignal = callOptions.abortSignal ?? deadline.signal;
  const pollingDelayAbortSignal =
    pollConfig?.delay == null ? statusAbortSignal : callOptions.abortSignal;
  const { retry: retryStatus } = prepareRetries({
    maxRetries,
    abortSignal: statusAbortSignal,
  });
"""
signals_new = """  const statusAbortSignal = callOptions.abortSignal ?? deadline.signal;
  const retryAbortSignal = deadline.retrySignal;
  const pollingDelayAbortSignal =
    pollConfig?.delay == null ? retryAbortSignal : callOptions.abortSignal;
  const { retry: retryStatus } = prepareRetries({
    maxRetries,
    abortSignal: retryAbortSignal,
  });
"""
if source.count(signals_old) != 1:
    raise SystemExit(
        f'expected one status/retry signal block, found {source.count(signals_old)}'
    )
source = source.replace(signals_old, signals_new, 1)

signal_old = """  const signal = abortSignal ?? deadlineController?.signal;
  let expired = false;
"""
signal_new = """  const signal = deadlineController?.signal;
  const retrySignal =
    signal == null
      ? abortSignal
      : abortSignal == null
        ? signal
        : mergeAbortSignals(abortSignal, signal);
  let expired = false;
"""
if source.count(signal_old) != 1:
    raise SystemExit(
        f'expected one deadline signal block, found {source.count(signal_old)}'
    )
source = source.replace(signal_old, signal_new, 1)

return_old = """  return {
    signal,
    assertActive,
"""
return_new = """  return {
    signal,
    retrySignal,
    assertActive,
"""
if source.count(return_old) != 1:
    raise SystemExit(
        f'expected one deadline return block, found {source.count(return_old)}'
    )
source_path.write_text(source.replace(return_old, return_new, 1))

test = test_path.read_text()
new_test = r'''

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
'''
closing = '\n});\n'
if not test.endswith(closing):
    raise SystemExit('focused test closing marker changed')
if 'stops retry scheduling at the deadline while preserving the caller signal' in test:
    raise SystemExit('caller-signal retry deadline test already exists')
test_path.write_text(test[: -len(closing)] + new_test + closing)

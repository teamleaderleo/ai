from pathlib import Path

source_path = Path('packages/ai/src/generate-video/generate-video.ts')
test_path = Path(
    'packages/ai/src/generate-video/core-video-operation-deadline.test.ts'
)

source = source_path.read_text()

abort_race_old = """  // Promise.race adopts losing operations. This handler also covers a
  // zero-duration deadline before the first race is installed.
  void timeoutPromise.catch(() => {});

  return {
"""
abort_race_new = """  // Promise.race adopts losing operations. This handler also covers a
  // zero-duration deadline before the first race is installed.
  void timeoutPromise.catch(() => {});

  let removeCallerAbortListener: (() => void) | undefined;
  const callerAbortPromise: Promise<never> =
    abortSignal == null
      ? new Promise<never>(() => {})
      : new Promise<never>((_, reject) => {
          const rejectForAbort = () => {
            reject(
              abortSignal.reason ?? new DOMException('Aborted', 'AbortError'),
            );
          };

          if (abortSignal.aborted) {
            rejectForAbort();
            return;
          }

          abortSignal.addEventListener('abort', rejectForAbort, { once: true });
          removeCallerAbortListener = () => {
            abortSignal.removeEventListener('abort', rejectForAbort);
          };
        });
  void callerAbortPromise.catch(() => {});

  return {
"""
if source.count(abort_race_old) != 1:
    raise SystemExit(
        f'expected one deadline race prelude, found {source.count(abort_race_old)}'
    )
source = source.replace(abort_race_old, abort_race_new, 1)

promise_race_old = """        const result = await Promise.race([
          Promise.resolve(operation),
          timeoutPromise,
        ]);
"""
promise_race_new = """        const result = await Promise.race([
          Promise.resolve(operation),
          timeoutPromise,
          callerAbortPromise,
        ]);
"""
if source.count(promise_race_old) != 1:
    raise SystemExit(
        f'expected one operation Promise.race, found {source.count(promise_race_old)}'
    )
source = source.replace(promise_race_old, promise_race_new, 1)

dispose_old = """    dispose(): void {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
    },
"""
dispose_new = """    dispose(): void {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
      removeCallerAbortListener?.();
    },
"""
if source.count(dispose_old) != 1:
    raise SystemExit(
        f'expected one deadline dispose block, found {source.count(dispose_old)}'
    )
source_path.write_text(source.replace(dispose_old, dispose_new, 1))

test = test_path.read_text()
new_test = r'''

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
'''
closing = '\n});\n'
if not test.endswith(closing):
    raise SystemExit('focused test closing marker changed')
if 'preserves caller abort when a status transport ignores its signal' in test:
    raise SystemExit('ignored-transport caller-abort test already exists')
test_path.write_text(test[: -len(closing)] + new_test + closing)

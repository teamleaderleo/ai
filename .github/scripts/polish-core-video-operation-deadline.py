from pathlib import Path

source_path = Path('packages/ai/src/generate-video/generate-video.ts')
test_path = Path(
    'packages/ai/src/generate-video/core-video-operation-deadline.test.ts'
)

source = source_path.read_text()
catch_old = """      } catch (error) {
        if (expired || !(Date.now() < deadlineAt)) {
          throwTimeout();
        }
        throw error;
      }
"""
catch_new = """      } catch (error) {
        if (expired || !(Date.now() < deadlineAt)) {
          throwTimeout();
        }
        if (abortSignal?.aborted) {
          throw (
            abortSignal.reason ?? new DOMException('Aborted', 'AbortError')
          );
        }
        throw error;
      }
"""
if source.count(catch_old) != 1:
    raise SystemExit(
        f'expected one deadline race catch block, found {source.count(catch_old)}'
    )
source_path.write_text(source.replace(catch_old, catch_new, 1))

test = test_path.read_text()
new_test = r'''

  it('preserves the caller abort reason when cooperative work rejects generically', async () => {
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
        doStatus: ({ abortSignal }) =>
          new Promise<never>((_resolve, reject) => {
            markStatusStarted();
            abortSignal?.addEventListener(
              'abort',
              () => reject(new DOMException('Transport stopped', 'AbortError')),
              { once: true },
            );
          }),
      }),
      prompt: 'caller abort arbitration test',
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
if 'preserves the caller abort reason when cooperative work rejects generically' in test:
    raise SystemExit('caller-abort arbitration test already exists')
test_path.write_text(test[: -len(closing)] + new_test + closing)

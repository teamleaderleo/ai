import { afterEach, describe, expect, it, vi } from 'vitest';
import { withPollingDeadline } from './with-polling-deadline';

afterEach(() => {
  vi.useRealTimers();
});

describe('withPollingDeadline', () => {
  it('returns an operation result before the deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    await expect(
      withPollingDeadline({
        timeoutMs: 10,
        execute: async () => 'done',
        createTimeoutError: () => new Error('timeout'),
        createAbortError: () => new Error('aborted'),
      }),
    ).resolves.toBe('done');
  });

  it('settles at the deadline when the operation never settles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const timeoutError = new Error('timeout');

    const result = withPollingDeadline({
      timeoutMs: 10,
      execute: () => new Promise<never>(() => {}),
      createTimeoutError: () => timeoutError,
      createAbortError: () => new Error('aborted'),
    });
    const assertion = expect(result).rejects.toBe(timeoutError);

    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });

  it('does not publish a result returned after the deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const timeoutError = new Error('timeout');
    let resolveOperation!: (value: string) => void;

    const result = withPollingDeadline({
      timeoutMs: 10,
      execute: () =>
        new Promise<string>(resolve => {
          resolveOperation = resolve;
        }),
      createTimeoutError: () => timeoutError,
      createAbortError: () => new Error('aborted'),
    });
    const assertion = expect(result).rejects.toBe(timeoutError);

    await vi.advanceTimersByTimeAsync(10);
    resolveOperation('late');
    await assertion;
  });

  it('preserves caller abort separately from timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const controller = new AbortController();
    const abortError = new Error('aborted');

    const result = withPollingDeadline({
      timeoutMs: 10,
      abortSignal: controller.signal,
      execute: () => new Promise<never>(() => {}),
      createTimeoutError: () => new Error('timeout'),
      createAbortError: () => abortError,
    });
    const assertion = expect(result).rejects.toBe(abortError);

    controller.abort();
    await assertion;
  });
});

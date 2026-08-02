export async function withPollingDeadline<T>({
  timeoutMs,
  abortSignal,
  execute,
  createTimeoutError,
  createAbortError,
  now = Date.now,
}: {
  timeoutMs: number;
  abortSignal?: AbortSignal;
  execute: (abortSignal: AbortSignal) => PromiseLike<T>;
  createTimeoutError: () => Error;
  createAbortError: () => Error;
  now?: () => number;
}): Promise<T> {
  const startedAt = now();
  const timeoutReason = {};
  const timeoutController = new AbortController();
  const pollingSignal = abortSignal
    ? AbortSignal.any([abortSignal, timeoutController.signal])
    : timeoutController.signal;

  let removeAbortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    const rejectForSignal = () => {
      reject(
        pollingSignal.reason === timeoutReason
          ? createTimeoutError()
          : createAbortError(),
      );
    };

    if (pollingSignal.aborted) {
      rejectForSignal();
      return;
    }

    pollingSignal.addEventListener('abort', rejectForSignal, { once: true });
    removeAbortListener = () =>
      pollingSignal.removeEventListener('abort', rejectForSignal);
  });

  const timeoutId = setTimeout(
    () => timeoutController.abort(timeoutReason),
    timeoutMs,
  );

  const execution = Promise.resolve()
    .then(() => execute(pollingSignal))
    .then(
      result => {
        if (pollingSignal.aborted) {
          throw pollingSignal.reason === timeoutReason
            ? createTimeoutError()
            : createAbortError();
        }

        // Custom FetchFunction implementations are injectable and are not
        // guaranteed to observe an AbortSignal. The elapsed-time guard keeps a
        // late result from becoming authoritative even when transport abort is
        // ignored.
        if (now() - startedAt >= timeoutMs) {
          throw createTimeoutError();
        }

        return result;
      },
      error => {
        if (pollingSignal.aborted) {
          throw pollingSignal.reason === timeoutReason
            ? createTimeoutError()
            : createAbortError();
        }
        throw error;
      },
    );

  try {
    // Racing the signal makes the caller deadline authoritative even when an
    // injected transport never settles. The combined signal still requests
    // cooperative cancellation from delay() and provider fetch calls.
    return await Promise.race([execution, aborted]);
  } finally {
    clearTimeout(timeoutId);
    removeAbortListener?.();
  }
}

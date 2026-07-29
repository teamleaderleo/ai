const STREAM_OPEN_COMMENT = ': stream-open\n\n';
const KEEP_ALIVE_COMMENT = ': keep-alive\n\n';

/**
 * Adds an immediate SSE comment and periodic idle comments to a string stream.
 *
 * The wrapper keeps at most one source read pending. Heartbeats are emitted only
 * when the response branch has demand, so a slow or disconnected client does
 * not accumulate an unbounded queue of comments. Cancelling the wrapper cancels
 * its source branch and clears the timer.
 */
export function createSseKeepAliveStream({
  stream,
  keepAliveMs,
}: {
  stream: ReadableStream<string>;
  keepAliveMs: number;
}): ReadableStream<string> {
  if (!Number.isFinite(keepAliveMs) || keepAliveMs <= 0) {
    throw new TypeError('keepAliveMs must be a finite number greater than 0.');
  }

  const reader = stream.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const scheduleHeartbeat = (
    controller: ReadableStreamDefaultController<string>,
  ) => {
    clearTimer();
    timer = setTimeout(() => {
      if (closed) {
        return;
      }

      // Skip rather than buffer a heartbeat when the client branch is not
      // currently asking for data. A later interval will try again.
      if ((controller.desiredSize ?? 0) > 0) {
        controller.enqueue(KEEP_ALIVE_COMMENT);
      }

      scheduleHeartbeat(controller);
    }, keepAliveMs);
  };

  return new ReadableStream<string>({
    start(controller) {
      // This first body byte lets HTTP runtimes flush the status and headers
      // even when the underlying UI-message source is currently idle.
      controller.enqueue(STREAM_OPEN_COMMENT);
      scheduleHeartbeat(controller);
    },

    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        // Cancellation can resolve the pending source read after the wrapper's
        // controller has already been cancelled. Do not close or error it again.
        if (closed) {
          return;
        }

        if (done) {
          closed = true;
          clearTimer();
          controller.close();
          return;
        }

        controller.enqueue(value);
        scheduleHeartbeat(controller);
      } catch (error) {
        if (closed) {
          return;
        }

        closed = true;
        clearTimer();
        controller.error(error);
      }
    },

    async cancel(reason) {
      closed = true;
      clearTimer();
      await reader.cancel(reason);
    },
  });
}

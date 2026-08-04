import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpMCPTransport } from './mcp-http-transport';

type ControlledInboundSseReader = {
  read: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  releaseLock: ReturnType<typeof vi.fn>;
};

function createInboundSseResponse(
  reader: ControlledInboundSseReader,
): Response {
  const body = {
    pipeThrough() {
      return body;
    },
    getReader() {
      return reader;
    },
  };

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body,
  } as unknown as Response;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flushMicrotasks(iterations = 8): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

describe('HttpMCPTransport inbound SSE reader release', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('releases the inbound reader after clean EOF before reconnecting', async () => {
    let getCalls = 0;
    const reader: ControlledInboundSseReader = {
      read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          getCalls += 1;
          return getCalls === 1
            ? createInboundSseResponse(reader)
            : new Response(null, { status: 405 });
        }
        return new Response(null, { status: 202 });
      },
    );
    const transport = new HttpMCPTransport({
      url: 'http://localhost:4000/mcp',
      fetch,
    });

    try {
      await transport.start();
      await flushMicrotasks();

      expect(reader.read).toHaveBeenCalledTimes(1);
      expect(reader.cancel).not.toHaveBeenCalled();
      expect(reader.releaseLock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();
      expect(getCalls).toBe(2);
    } finally {
      await transport.close();
    }
  });

  it('releases the inbound reader after close settles a pending read', async () => {
    const pendingRead = deferred<{ done: boolean; value: undefined }>();
    const reader: ControlledInboundSseReader = {
      read: vi.fn().mockReturnValue(pendingRead.promise),
      cancel: vi.fn().mockImplementation(() => {
        pendingRead.resolve({ done: true, value: undefined });
        return Promise.resolve();
      }),
      releaseLock: vi.fn(),
    };
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'GET'
        ? createInboundSseResponse(reader)
        : new Response(null, { status: 202 }),
    );
    const transport = new HttpMCPTransport({
      url: 'http://localhost:4000/mcp',
      fetch,
    });

    await transport.start();
    await flushMicrotasks();
    expect(reader.read).toHaveBeenCalledTimes(1);

    await transport.close();
    await flushMicrotasks();

    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('preserves read-error precedence and releases the lock when cancellation rejects', async () => {
    const readError = new Error('inbound read failed');
    const cancelError = new Error('inbound cancel failed');
    const errors: unknown[] = [];
    const reader: ControlledInboundSseReader = {
      read: vi.fn().mockRejectedValue(readError),
      cancel: vi.fn().mockRejectedValue(cancelError),
      releaseLock: vi.fn(),
    };
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'GET'
        ? createInboundSseResponse(reader)
        : new Response(null, { status: 202 }),
    );
    const transport = new HttpMCPTransport({
      url: 'http://localhost:4000/mcp',
      fetch,
    });
    transport.onerror = error => {
      errors.push(error);
    };

    try {
      await transport.start();
      await flushMicrotasks(16);

      expect(errors).toEqual([readError, cancelError]);
      expect(reader.cancel).toHaveBeenCalledTimes(1);
      expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    } finally {
      await transport.close();
    }
  });
});

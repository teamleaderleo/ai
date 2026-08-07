import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSONRPCMessage } from './json-rpc-message';
import { HttpMCPTransport } from './mcp-http-transport';

const notification: JSONRPCMessage = {
  jsonrpc: '2.0',
  method: 'notifications/initialized',
};

async function flushMicrotasks(iterations = 8): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

describe('HttpMCPTransport current-main HTTP retry / 202 interaction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.fails('retries a retryable inbound HTTP response after the existing delay', async () => {
    let getCalls = 0;
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== 'GET') {
          return new Response(null, { status: 202 });
        }

        getCalls += 1;
        return getCalls === 1
          ? new Response(null, { status: 503, statusText: 'unavailable' })
          : new Response(null, { status: 405 });
      },
    );
    const transport = new HttpMCPTransport({
      url: 'http://localhost:4000/mcp',
      fetch,
    });

    try {
      await transport.start();
      await flushMicrotasks();
      expect(getCalls).toBe(1);

      await vi.advanceTimersByTimeAsync(999);
      expect(getCalls).toBe(1);

      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
      expect(getCalls).toBe(2);
    } finally {
      await transport.close();
    }
  });

  it('lets a later 202 restart supersede any earlier retry schedule', async () => {
    let getCalls = 0;
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          getCalls += 1;
          return getCalls === 1
            ? new Response(null, { status: 503, statusText: 'unavailable' })
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
      expect(getCalls).toBe(1);

      // A fresh protocol-driven restart should own the channel. If a retry was
      // already scheduled for the first failure, it must not create a later
      // duplicate GET after this explicit restart has completed.
      await vi.advanceTimersByTimeAsync(500);
      await transport.send(notification);
      await flushMicrotasks();
      expect(getCalls).toBe(2);

      await vi.advanceTimersByTimeAsync(500);
      await flushMicrotasks();
      expect(getCalls).toBe(2);
    } finally {
      await transport.close();
    }
  });
});

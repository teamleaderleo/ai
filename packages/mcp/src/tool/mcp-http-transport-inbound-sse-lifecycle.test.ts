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

describe('HttpMCPTransport inbound SSE lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the initial inbound GET single-flight while it is connecting', async () => {
    let getCalls = 0;
    let markFirstGetStarted!: () => void;
    let releaseFirstGet!: () => void;

    const firstGetStarted = new Promise<void>(resolve => {
      markFirstGetStarted = resolve;
    });
    const firstGetResponse = new Promise<Response>(resolve => {
      releaseFirstGet = () => resolve(new Response(null, { status: 405 }));
    });

    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          getCalls += 1;
          if (getCalls === 1) {
            markFirstGetStarted();
            return firstGetResponse;
          }
          return new Response(null, { status: 405 });
        }

        if (init?.method === 'POST') {
          return new Response(null, { status: 202 });
        }

        return new Response(null, { status: 200 });
      },
    );

    const transport = new HttpMCPTransport({
      url: 'http://localhost:4000/mcp',
      fetch,
    });

    try {
      await transport.start();
      await firstGetStarted;

      await transport.send(notification);
      await flushMicrotasks();

      expect(getCalls).toBe(1);
    } finally {
      releaseFirstGet();
      await flushMicrotasks();
      await transport.close();
    }
  });

  it('allows a replacement inbound GET after the previous stream reaches clean EOF', async () => {
    let getCalls = 0;
    let markFirstReaderPull!: () => void;
    const firstReaderPull = new Promise<void>(resolve => {
      markFirstReaderPull = resolve;
    });

    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          getCalls += 1;
          if (getCalls === 1) {
            return new Response(
              new ReadableStream({
                pull(controller) {
                  markFirstReaderPull();
                  controller.close();
                },
              }),
              { headers: { 'content-type': 'text/event-stream' } },
            );
          }
          return new Response(null, { status: 405 });
        }

        if (init?.method === 'POST') {
          return new Response(null, { status: 202 });
        }

        return new Response(null, { status: 200 });
      },
    );

    const transport = new HttpMCPTransport({
      url: 'http://localhost:4000/mcp',
      fetch,
    });

    try {
      await transport.start();
      await firstReaderPull;
      await flushMicrotasks();

      await transport.send(notification);
      await flushMicrotasks();

      expect(getCalls).toBe(2);
    } finally {
      await transport.close();
    }
  });

  it('bounds automatic reconnects when inbound streams immediately reach clean EOF', async () => {
    let getCalls = 0;
    const errors: unknown[] = [];

    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          getCalls += 1;
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.close();
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          );
        }

        return new Response(null, { status: 202 });
      },
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
      await flushMicrotasks();
      expect(getCalls).toBe(1);

      await vi.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();
      expect(getCalls).toBe(2);

      await vi.advanceTimersByTimeAsync(1500);
      await flushMicrotasks();
      expect(getCalls).toBe(3);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        message:
          'MCP HTTP Transport Error: Maximum reconnection attempts (2) exceeded.',
      });

      await vi.advanceTimersByTimeAsync(30000);
      expect(getCalls).toBe(3);
    } finally {
      await transport.close();
    }
  });

  it('cancels a scheduled clean-EOF reconnect when the transport closes', async () => {
    let getCalls = 0;
    let markReaderPull!: () => void;
    const readerPull = new Promise<void>(resolve => {
      markReaderPull = resolve;
    });

    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          getCalls += 1;
          return new Response(
            new ReadableStream({
              pull(controller) {
                markReaderPull();
                controller.close();
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          );
        }

        return new Response(null, { status: 202 });
      },
    );

    const transport = new HttpMCPTransport({
      url: 'http://localhost:4000/mcp',
      fetch,
    });

    await transport.start();
    await readerPull;
    await flushMicrotasks();
    await transport.close();

    await vi.advanceTimersByTimeAsync(30000);
    expect(getCalls).toBe(1);
  });

  it('resets the reconnect budget after receiving an inbound event', async () => {
    let getCalls = 0;
    const errors: unknown[] = [];

    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== 'GET') {
          return new Response(null, { status: 202 });
        }

        getCalls += 1;
        if (getCalls === 2) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"jsonrpc":"2.0","method":"notifications/test"}\n\n',
                  ),
                );
                controller.close();
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          );
        }

        return new Response(
          new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
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
      await flushMicrotasks();

      await vi.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();
      expect(getCalls).toBe(2);

      // The second connection delivered an event before closing, so its next
      // retry uses the initial delay again instead of the grown 1500 ms delay.
      await vi.advanceTimersByTimeAsync(999);
      expect(getCalls).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
      expect(getCalls).toBe(3);
      expect(errors).toHaveLength(0);
    } finally {
      await transport.close();
    }
  });
});

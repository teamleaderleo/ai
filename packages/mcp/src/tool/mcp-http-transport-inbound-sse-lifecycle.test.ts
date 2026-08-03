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

  it('allows a 202 response to replace a cleanly ended inbound GET', async () => {
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

      // The explicit restart owns the channel and cancels the pending automatic
      // reconnect, so no third GET appears later.
      await vi.advanceTimersByTimeAsync(30000);
      expect(getCalls).toBe(2);
    } finally {
      await transport.close();
    }
  });

  it('respects the SSE retry field and resumes with Last-Event-ID', async () => {
    let getCalls = 0;
    const getHeaders: Array<Record<string, string>> = [];

    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== 'GET') {
          return new Response(null, { status: 202 });
        }

        getCalls += 1;
        getHeaders.push(init.headers as Record<string, string>);

        if (getCalls === 1) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    [
                      'id: cursor-1',
                      'retry: 4321',
                      'data: {"jsonrpc":"2.0","method":"notifications/test"}',
                      '',
                      '',
                    ].join('\n'),
                  ),
                );
                controller.close();
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          );
        }

        return new Response(null, { status: 405 });
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

      await vi.advanceTimersByTimeAsync(4320);
      expect(getCalls).toBe(1);

      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
      expect(getCalls).toBe(2);
      expect(getHeaders[1]['last-event-id']).toBe('cursor-1');
    } finally {
      await transport.close();
    }
  });

  it('continues polling after more than two successful clean closures', async () => {
    let getCalls = 0;
    const errors: unknown[] = [];

    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== 'GET') {
          return new Response(null, { status: 202 });
        }

        getCalls += 1;
        if (getCalls >= 4) {
          return new Response(null, { status: 405 });
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
      expect(getCalls).toBe(1);

      for (let expectedCalls = 2; expectedCalls <= 4; expectedCalls += 1) {
        await vi.advanceTimersByTimeAsync(1000);
        await flushMicrotasks();
        expect(getCalls).toBe(expectedCalls);
      }

      expect(errors).toHaveLength(0);
    } finally {
      await transport.close();
    }
  });

  it('bounds consecutive failed reopen attempts', async () => {
    let getCalls = 0;
    const errors: unknown[] = [];
    const networkError = new TypeError('network down');

    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== 'GET') {
          return new Response(null, { status: 202 });
        }

        getCalls += 1;
        if (getCalls === 1) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.close();
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          );
        }

        throw networkError;
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

      await vi.advanceTimersByTimeAsync(1499);
      expect(getCalls).toBe(2);

      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
      expect(getCalls).toBe(3);
      expect(errors.filter(error => error === networkError)).toHaveLength(2);
      expect(errors.at(-1)).toMatchObject({
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
});

import { describe, expect, it, vi } from 'vitest';
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
});

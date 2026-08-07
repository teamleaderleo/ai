import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpMCPTransport } from './mcp-http-transport';

async function flushMicrotasks(iterations = 12): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

function getSseErrors(errors: unknown[]): Error[] {
  return errors.filter(
    (error): error is Error =>
      error instanceof Error && error.message.includes('GET SSE failed'),
  );
}

// These controls exercise the transport's existing bounded reconnect owner.
// They intentionally do not create or validate a second HTTP-specific retry loop.
describe('HttpMCPTransport inbound SSE retryable HTTP failures', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([408, 429, 500, 503, 599])(
    'retries HTTP status %i selected by retry policy and recovers',
    async status => {
      let getCalls = 0;
      const errors: unknown[] = [];
      const fetch = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method !== 'GET') {
            return new Response(null, { status: 202 });
          }

          getCalls += 1;
          return getCalls === 1
            ? new Response(null, {
                status,
                statusText: 'retryable failure',
              })
            : new Response(null, { status: 405 });
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
        expect(getSseErrors(errors)).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(999);
        expect(getCalls).toBe(1);

        await vi.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
        expect(getCalls).toBe(2);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(getCalls).toBe(2);
      } finally {
        await transport.close();
      }
    },
  );

  it('bounds repeated retryable HTTP failures with the existing retry budget', async () => {
    let getCalls = 0;
    const errors: unknown[] = [];
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== 'GET') {
          return new Response(null, { status: 202 });
        }
        getCalls += 1;
        return new Response(null, {
          status: 503,
          statusText: 'service unavailable',
        });
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

      await vi.advanceTimersByTimeAsync(1499);
      expect(getCalls).toBe(2);

      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
      expect(getCalls).toBe(3);
      expect(getSseErrors(errors)).toHaveLength(3);
      expect(errors.at(-1)).toMatchObject({
        message:
          'MCP HTTP Transport Error: Maximum reconnection attempts (2) exceeded.',
      });

      await vi.advanceTimersByTimeAsync(30_000);
      expect(getCalls).toBe(3);
    } finally {
      await transport.close();
    }
  });

  it('reports a permanent HTTP failure without starting a reconnect loop', async () => {
    let getCalls = 0;
    const errors: unknown[] = [];
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== 'GET') {
          return new Response(null, { status: 202 });
        }
        getCalls += 1;
        return new Response(null, {
          status: 400,
          statusText: 'bad request',
        });
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
      expect(getSseErrors(errors)).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(getCalls).toBe(1);
    } finally {
      await transport.close();
    }
  });
});

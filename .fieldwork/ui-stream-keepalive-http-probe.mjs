import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { get, createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const EXPECTED_CANDIDATE_HEAD =
  process.env.EXPECTED_CANDIDATE_HEAD ??
  '7c8b95b12e7a47e0f614ff949b645e546488eea7';

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function delay(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out after ${ms}ms: ${label}`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  return address.port;
}

async function closeServer(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise((resolvePromise, reject) => {
    server.close(error => (error ? reject(error) : resolvePromise()));
  });
}

function readHttpBody(port) {
  const firstChunk = deferred();
  const completed = deferred();
  let sawFirstChunk = false;

  const clientRequest = get(
    { hostname: '127.0.0.1', port, path: '/' },
    response => {
      const chunks = [];
      response.on('data', chunk => {
        chunks.push(chunk);
        if (!sawFirstChunk) {
          sawFirstChunk = true;
          firstChunk.resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            chunk: chunk.toString('utf8'),
          });
        }
      });
      response.on('end', () => {
        completed.resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
      response.on('error', error => completed.reject(error));
    },
  );

  clientRequest.on('error', error => {
    firstChunk.reject(error);
    completed.reject(error);
  });

  return {
    firstChunk: firstChunk.promise,
    completed: completed.promise,
    destroy: () => clientRequest.destroy(),
  };
}

const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
assert.equal(
  currentHead,
  EXPECTED_CANDIDATE_HEAD,
  'probe must execute the exact canonical candidate head',
);

const moduleUrl = pathToFileURL(
  resolve(
    process.cwd(),
    'packages/ai/src/ui-message-stream/pipe-ui-message-stream-to-response.ts',
  ),
).href;
const { pipeUIMessageStreamToResponse } = await import(moduleUrl);

async function proveImmediateOpeningByte() {
  let sourceController;
  let pipePromise;
  const source = new ReadableStream({
    start(controller) {
      sourceController = controller;
    },
  });

  const server = createServer((_request, response) => {
    pipePromise = pipeUIMessageStreamToResponse({
      response,
      stream: source,
      keepAliveMs: 10_000,
    });
    void pipePromise.catch(error => response.destroy(error));
  });

  const port = await listen(server);
  const client = readHttpBody(port);

  try {
    const first = await withTimeout(
      client.firstChunk,
      2_000,
      'opening SSE comment before the UI source emits',
    );
    assert.equal(first.statusCode, 200);
    assert.equal(first.chunk, ': stream-open\n\n');

    sourceController.close();
    const completed = await withTimeout(
      client.completed,
      2_000,
      'HTTP response completion after source close',
    );
    assert.equal(completed.body, ': stream-open\n\n');
    await withTimeout(pipePromise, 2_000, 'server pipe completion');
  } finally {
    client.destroy();
    try {
      sourceController.close();
    } catch {}
    await closeServer(server);
  }
}

async function proveProxyIdleLiveness() {
  const HEARTBEAT_MS = 75;
  const PROXY_IDLE_MS = 450;
  const IDLE_OBSERVATION_MS = 1_050;

  let sourceController;
  let upstreamPipePromise;
  let proxyTimedOut = false;

  const source = new ReadableStream({
    start(controller) {
      sourceController = controller;
    },
  });

  const upstream = createServer((_request, response) => {
    upstreamPipePromise = pipeUIMessageStreamToResponse({
      response,
      stream: source,
      keepAliveMs: HEARTBEAT_MS,
    });
    void upstreamPipePromise.catch(error => response.destroy(error));
  });
  const upstreamPort = await listen(upstream);

  const proxy = createServer((_request, downstreamResponse) => {
    let idleTimer;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        proxyTimedOut = true;
        upstreamRequest.destroy(new Error('proxy idle timeout'));
        downstreamResponse.destroy(new Error('proxy idle timeout'));
      }, PROXY_IDLE_MS);
    };

    const upstreamRequest = get(
      { hostname: '127.0.0.1', port: upstreamPort, path: '/' },
      upstreamResponse => {
        downstreamResponse.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        resetIdleTimer();
        upstreamResponse.on('data', chunk => {
          resetIdleTimer();
          downstreamResponse.write(chunk);
        });
        upstreamResponse.on('end', () => {
          clearTimeout(idleTimer);
          downstreamResponse.end();
        });
        upstreamResponse.on('error', error => {
          clearTimeout(idleTimer);
          downstreamResponse.destroy(error);
        });
      },
    );

    upstreamRequest.on('error', error => {
      clearTimeout(idleTimer);
      if (!downstreamResponse.destroyed) downstreamResponse.destroy(error);
    });
    resetIdleTimer();
  });
  const proxyPort = await listen(proxy);
  const client = readHttpBody(proxyPort);

  try {
    const first = await withTimeout(
      client.firstChunk,
      2_000,
      'opening comment through proxy',
    );
    assert.equal(first.chunk, ': stream-open\n\n');

    await delay(IDLE_OBSERVATION_MS);
    assert.equal(
      proxyTimedOut,
      false,
      'periodic SSE comments must keep the deliberately short-idle proxy open',
    );

    sourceController.close();
    const completed = await withTimeout(
      client.completed,
      3_000,
      'proxied stream completion',
    );
    const openingCount = completed.body.match(/: stream-open\n\n/g)?.length ?? 0;
    const keepAliveCount = completed.body.match(/: keep-alive\n\n/g)?.length ?? 0;
    assert.equal(openingCount, 1);
    assert(
      keepAliveCount >= 5,
      `expected at least five keep-alive comments, observed ${keepAliveCount}`,
    );
    await withTimeout(upstreamPipePromise, 2_000, 'upstream pipe completion');
  } finally {
    client.destroy();
    try {
      sourceController.close();
    } catch {}
    await closeServer(proxy);
    await closeServer(upstream);
  }
}

await proveImmediateOpeningByte();
await proveProxyIdleLiveness();

console.log(
  JSON.stringify({
    candidateHead: currentHead,
    node: process.version,
    openingByte: 'pass',
    proxyIdleLiveness: 'pass',
  }),
);

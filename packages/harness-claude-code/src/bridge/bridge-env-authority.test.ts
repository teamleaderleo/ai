import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type QueryArgs = {
  options: Record<string, unknown>;
};

const state = vi.hoisted(() => ({
  queryArgs: [] as QueryArgs[],
  start: {} as Record<string, unknown>,
  originalArgv: [] as string[],
  originalToken: undefined as string | undefined,
  originalPort: undefined as string | undefined,
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: QueryArgs) => {
    state.queryArgs.push(args);
    return (async function* () {
      yield {
        type: 'result',
        subtype: 'success',
        result: 'done',
      };
    })();
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {},
}));

vi.mock('@ai-sdk/harness/bridge', () => ({
  runBridge: async ({
    onStart,
  }: {
    onStart: (start: unknown, turn: unknown) => Promise<void>;
  }) => {
    await onStart(state.start, {
      abortSignal: new AbortController().signal,
      pendingUserMessages: [],
      firstTurn: true,
      emit: () => {},
      emitWarning: () => {},
      emitError: () => {},
      requestToolResult: async () => ({ output: {} }),
      requestToolApproval: async () => ({ approved: true }),
    });
  },
}));

describe('Claude Code bridge transport credential isolation', () => {
  beforeEach(() => {
    state.queryArgs = [];
    state.start = {
      prompt: 'Inspect the project.',
      thinking: { type: 'disabled' },
      env: {
        APPLICATION_ENV: 'staging',
      },
    };
    state.originalArgv = [...process.argv];
    state.originalToken = process.env.BRIDGE_CHANNEL_TOKEN;
    state.originalPort = process.env.BRIDGE_WS_PORT;
    process.env.BRIDGE_CHANNEL_TOKEN = 'synthetic-bridge-secret';
    process.env.BRIDGE_WS_PORT = '4319';
    process.argv.splice(
      0,
      process.argv.length,
      'node',
      'bridge.mjs',
      '--workdir',
      '/tmp/harness-claude-code-test/work',
      '--bridge-state-dir',
      '/tmp/harness-claude-code-test/state',
    );
  });

  afterEach(() => {
    process.argv.splice(0, process.argv.length, ...state.originalArgv);
    if (state.originalToken === undefined) {
      delete process.env.BRIDGE_CHANNEL_TOKEN;
    } else {
      process.env.BRIDGE_CHANNEL_TOKEN = state.originalToken;
    }
    if (state.originalPort === undefined) {
      delete process.env.BRIDGE_WS_PORT;
    } else {
      process.env.BRIDGE_WS_PORT = state.originalPort;
    }
    vi.resetModules();
  });

  test('does not forward bridge transport credentials to the Agent SDK subprocess environment', async () => {
    await import('./index');

    const env = state.queryArgs[0]?.options.env as
      | Record<string, string | undefined>
      | undefined;

    expect(env).toMatchObject({
      APPLICATION_ENV: 'staging',
    });
    expect(env).not.toHaveProperty('BRIDGE_CHANNEL_TOKEN');
    expect(env).not.toHaveProperty('BRIDGE_WS_PORT');
  });
});

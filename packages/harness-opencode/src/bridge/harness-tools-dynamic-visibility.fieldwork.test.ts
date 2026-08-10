import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type * as EmitModule from './create-emit-stream-event';

type Start = {
  prompt: string;
  mcpServers?: Record<string, unknown>;
};

const state = vi.hoisted(() => ({
  start: {} as Start,
  originalArgv: [] as string[],
  isMcpToolName: undefined as ((toolName: string) => boolean) | undefined,
}));

vi.mock('@opencode-ai/sdk/v2', () => {
  const emptyStream = {
    async *[Symbol.asyncIterator]() {},
  };
  const client = {
    mcp: {
      status: async () => ({
        data: {
          'harness-tools': { status: 'connected' },
        },
      }),
    },
    session: {
      create: async () => ({ data: { id: 'session-1' } }),
      promptAsync: async () => ({ data: {} }),
    },
    event: {
      subscribe: async () => ({ stream: emptyStream }),
    },
  };
  return {
    createOpencodeServer: vi.fn(async () => ({ url: 'http://127.0.0.1:4319' })),
    createOpencodeClient: vi.fn(() => client),
  };
});

vi.mock('./create-emit-stream-event', async importOriginal => {
  const actual = await importOriginal<typeof EmitModule>();
  return {
    ...actual,
    createEmitStreamEvent: vi.fn((options: Parameters<typeof actual.createEmitStreamEvent>[0]) => {
      state.isMcpToolName = options.isMcpToolName;
      return () => {};
    }),
  };
});

vi.mock('@ai-sdk/harness/bridge', () => ({
  runBridge: async ({ onStart }: { onStart: (start: Start, turn: unknown) => Promise<void> }) => {
    await onStart(state.start, {
      abortSignal: new AbortController().signal,
      pendingUserMessages: [],
      firstTurn: true,
      emit: () => {},
      emitWarning: () => {},
      emitError: () => {},
      requestToolResult: async () => ({ output: null }),
      requestToolApproval: async () => ({ approved: false }),
    });
  },
}));

describe('Fieldwork: OpenCode external MCP dynamic visibility', () => {
  beforeEach(() => {
    state.isMcpToolName = undefined;
    state.originalArgv = [...process.argv];
    process.argv.splice(
      0,
      process.argv.length,
      'node',
      'bridge.mjs',
      '--workdir',
      '/tmp/opencode-fieldwork/work',
      '--bridge-state-dir',
      '/tmp/opencode-fieldwork/state',
      '--bootstrap-dir',
      '/tmp/opencode-fieldwork/bootstrap',
    );
  });

  afterEach(() => {
    process.argv.splice(0, process.argv.length, ...state.originalArgv);
    vi.resetModules();
  });

  test('external harness-tools server keeps dynamic MCP classification', async () => {
    state.start = {
      prompt: 'Inspect the project.',
      mcpServers: {
        'harness-tools': {
          type: 'remote',
          url: 'https://example.invalid/mcp',
          enabled: true,
        },
      },
    };

    await import('./index');

    expect(state.isMcpToolName).toBeDefined();
    expect(state.isMcpToolName?.('harness-tools_external-query')).toBe(true);
  });
});

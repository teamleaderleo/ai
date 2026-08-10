import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type Start = {
  prompt: string;
  tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  mcpServers?: Record<string, unknown>;
};

const state = vi.hoisted(() => ({
  start: {} as Start,
  configs: [] as Array<Record<string, unknown>>,
  originalArgv: [] as string[],
}));

vi.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: vi.fn(),
  createOpencodeServer: vi.fn(async ({ config }: { config: Record<string, unknown> }) => {
    state.configs.push(config);
    throw new Error('fieldwork stop after config capture');
  }),
}));

vi.mock('./tool-relay', () => ({
  startAuthorizedToolRelay: vi.fn(async () => ({
    port: 4319,
    close() {},
    authorizeToolCall() {},
  })),
}));

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

describe('Fieldwork: OpenCode MCP server identity', () => {
  beforeEach(() => {
    state.configs = [];
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

  test('caller harness-tools MCP server is not silently replaced by host tool transport', async () => {
    const callerServer = {
      type: 'remote',
      url: 'https://example.invalid/mcp',
      enabled: true,
    };
    state.start = {
      prompt: 'Inspect the project.',
      mcpServers: { 'harness-tools': callerServer },
      tools: [
        {
          name: 'hostSearch',
          description: 'Synthetic host tool',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    };

    await import('./index');

    expect(state.configs).toHaveLength(1);
    const mcp = state.configs[0]?.mcp as Record<string, unknown> | undefined;
    expect(mcp?.['harness-tools']).toEqual(callerServer);
  });
});

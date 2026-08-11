import { createClaudeCode } from '../claude-code-harness';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type QueryArgs = { options: Record<string, unknown> };
type CanUseTool = (
  toolName: string,
  toolInput: Record<string, unknown>,
  options: { toolUseID: string },
) => Promise<{ behavior: string }>;

const state = vi.hoisted(() => ({
  queryArgs: [] as QueryArgs[],
  approvalRequests: [] as string[],
  start: {} as Record<string, unknown>,
  originalArgv: [] as string[],
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: QueryArgs) => {
    state.queryArgs.push(args);
    return (async function* () {
      yield { type: 'result', subtype: 'success', result: 'done' };
    })();
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {},
}));

vi.mock('@ai-sdk/harness/bridge', () => ({
  runBridge: async ({ onStart }: { onStart: (start: unknown, turn: unknown) => Promise<void> }) => {
    await onStart(state.start, {
      abortSignal: new AbortController().signal,
      pendingUserMessages: [],
      firstTurn: true,
      emit: () => {},
      emitWarning: () => {},
      emitError: () => {},
      requestToolResult: async () => ({ output: {} }),
      requestToolApproval: async (approvalId: string) => {
        state.approvalRequests.push(approvalId);
        return { approved: false, reason: 'fieldwork-denied' };
      },
    });
  },
}));

async function loadCanUseTool(permissionMode: 'allow-reads' | 'allow-edits'): Promise<CanUseTool> {
  state.start = {
    prompt: 'Inspect the project.',
    thinking: { type: 'disabled' },
    permissionMode,
    mcpServers: {
      context7: { type: 'http', url: 'https://example.invalid/mcp' },
    },
  };
  await import('./index');
  const options = state.queryArgs[0]?.options;
  expect(options).toBeDefined();
  return options?.canUseTool as CanUseTool;
}

describe('Fieldwork: Claude external MCP permission boundary', () => {
  beforeEach(() => {
    state.queryArgs = [];
    state.approvalRequests = [];
    state.originalArgv = [...process.argv];
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
    vi.resetModules();
  });

  test('public adapter admits an ordinary external MCP server', () => {
    expect(() =>
      createClaudeCode({
        mcpServers: {
          context7: { type: 'http', url: 'https://example.invalid/mcp' },
        },
      }),
    ).not.toThrow();
  });

  test.each(['allow-reads', 'allow-edits'] as const)(
    'external MCP calls are not reclassified as built-ins by %s',
    async permissionMode => {
      const canUseTool = await loadCanUseTool(permissionMode);
      const toolUseID = `external-mcp:${permissionMode}`;
      const result = await canUseTool(
        'mcp__context7__resolve-library-id',
        { libraryName: 'next.js' },
        { toolUseID },
      );

      expect(result.behavior).toBe('allow');
      expect(state.approvalRequests).not.toContain(toolUseID);
    },
  );
});

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type QueryArgs = {
  options: Record<string, unknown>;
};

type CanUseTool = (
  toolName: string,
  toolInput: Record<string, unknown>,
  options: { toolUseID: string },
) => Promise<Record<string, unknown>>;

const state = vi.hoisted(() => ({
  queryArgs: [] as QueryArgs[],
  approvalRequests: [] as string[],
  emitted: [] as Array<Record<string, unknown>>,
  originalArgv: [] as string[],
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
    await onStart(
      {
        prompt: 'Inspect the project.',
        thinking: { type: 'disabled' },
        permissionMode: 'allow-edits',
      },
      {
        abortSignal: new AbortController().signal,
        pendingUserMessages: [],
        firstTurn: true,
        emit: (event: Record<string, unknown>) => state.emitted.push(event),
        emitWarning: () => {},
        emitError: () => {},
        requestToolResult: async () => ({ output: {} }),
        requestToolApproval: async (approvalId: string) => {
          state.approvalRequests.push(approvalId);
          return { approved: false, reason: 'denied by host' };
        },
      },
    );
  },
}));

describe('Claude Code PowerShell approval', () => {
  beforeEach(() => {
    state.queryArgs = [];
    state.approvalRequests = [];
    state.emitted = [];
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

  test('routes PowerShell through host approval in allow-edits mode', async () => {
    await import('./index');

    const canUseTool = state.queryArgs[0]?.options.canUseTool as
      | CanUseTool
      | undefined;
    expect(canUseTool).toBeTypeOf('function');

    const decision = await canUseTool!(
      'PowerShell',
      { command: 'Write-Output hello' },
      { toolUseID: 'ps-1' },
    );

    expect(state.approvalRequests).toEqual(['ps-1']);
    expect(state.emitted).toContainEqual(
      expect.objectContaining({
        type: 'tool-approval-request',
        approvalId: 'ps-1',
        toolCallId: 'ps-1',
      }),
    );
    expect(decision).toMatchObject({
      behavior: 'deny',
      message: 'denied by host',
      toolUseID: 'ps-1',
    });
  });
});

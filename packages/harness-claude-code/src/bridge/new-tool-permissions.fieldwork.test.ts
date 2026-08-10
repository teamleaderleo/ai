import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type QueryArgs = {
  options: Record<string, unknown>;
};

const state = vi.hoisted(() => ({
  queryArgs: [] as QueryArgs[],
  start: {} as Record<string, unknown>,
  approvalRequests: [] as string[],
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

type CanUseTool = (
  toolName: string,
  toolInput: Record<string, unknown>,
  options: { toolUseID: string },
) => Promise<{ behavior: string }>;

async function loadCanUseTool(
  permissionMode: 'allow-reads' | 'allow-edits',
): Promise<CanUseTool> {
  state.start = {
    prompt: 'Inspect the project.',
    thinking: { type: 'disabled' },
    permissionMode,
  };

  await import('./index');

  const canUseTool = state.queryArgs[0]?.options.canUseTool;
  expect(typeof canUseTool).toBe('function');
  return canUseTool as CanUseTool;
}

describe('Fieldwork: new Claude built-in permission parity', () => {
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

  test('known Bash remains approval-gated in allow-edits mode', async () => {
    const canUseTool = await loadCanUseTool('allow-edits');

    await expect(
      canUseTool('Bash', { command: 'echo hi' }, { toolUseID: 'bash-1' }),
    ).resolves.toMatchObject({ behavior: 'deny' });
    expect(state.approvalRequests).toEqual(['bash-1']);
  });

  test('new PowerShell is approval-gated in allow-edits mode like its declared bash kind', async () => {
    const canUseTool = await loadCanUseTool('allow-edits');

    await expect(
      canUseTool(
        'PowerShell',
        { command: 'Write-Output hi' },
        { toolUseID: 'powershell-1' },
      ),
    ).resolves.toMatchObject({ behavior: 'deny' });
    expect(state.approvalRequests).toEqual(['powershell-1']);
  });

  test('known Read remains approval-free in allow-reads mode', async () => {
    const canUseTool = await loadCanUseTool('allow-reads');

    await expect(
      canUseTool('Read', { file_path: '/tmp/a' }, { toolUseID: 'read-1' }),
    ).resolves.toMatchObject({ behavior: 'allow' });
    expect(state.approvalRequests).toEqual([]);
  });

  test('new CronList remains approval-free in allow-reads mode like its declared readonly kind', async () => {
    const canUseTool = await loadCanUseTool('allow-reads');

    await expect(
      canUseTool('CronList', {}, { toolUseID: 'cron-list-1' }),
    ).resolves.toMatchObject({ behavior: 'allow' });
    expect(state.approvalRequests).toEqual([]);
  });
});

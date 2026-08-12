import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type QueryArgs = { options: Record<string, unknown> };
type CanUseTool = (
  toolName: string,
  toolInput: Record<string, unknown>,
  options: { toolUseID: string },
) => Promise<{ behavior: string }>;
type PreToolUseHook = (
  input: {
    hook_event_name: 'PreToolUse';
    tool_name: string;
    tool_input: unknown;
    tool_use_id: string;
  },
) => Promise<Record<string, unknown>>;

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

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({ McpServer: class {} }));

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
        return { approved: false, reason: 'test-denied' };
      },
    });
  },
}));

async function loadOptions(
  permissionMode: 'allow-reads' | 'allow-edits' | 'allow-all',
) {
  state.start = {
    prompt: 'Inspect the project.',
    thinking: { type: 'disabled' },
    permissionMode,
    mcpServers: {
      context7: { type: 'http', url: 'https://example.invalid/mcp' },
    },
  };
  await import('./bridge/index');
  const options = state.queryArgs[0]?.options;
  expect(options).toBeDefined();
  return options!;
}

function getPreToolUseHook(options: Record<string, unknown>): PreToolUseHook {
  const hooks = options.hooks as {
    PreToolUse?: Array<{ hooks?: PreToolUseHook[] }>;
  };
  const hook = hooks.PreToolUse?.[0]?.hooks?.[0];
  expect(hook).toBeDefined();
  return hook!;
}

async function hookDecision(hook: PreToolUseHook, toolName: string) {
  return hook({
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: {},
    tool_use_id: `hook:${toolName}`,
  });
}

describe('Claude unknown native permission boundary', () => {
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

  test.each(['allow-reads', 'allow-edits'] as const)(
    'unknown native tools force an ask and enter host approval under %s',
    async permissionMode => {
      const options = await loadOptions(permissionMode);
      const hook = getPreToolUseHook(options);
      await expect(
        hookDecision(hook, 'FutureNativeProcessTool'),
      ).resolves.toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason:
            'Unknown Claude native tool requires host approval.',
        },
      });

      const canUseTool = options.canUseTool as CanUseTool;
      const id = `unknown:${permissionMode}`;
      await expect(
        canUseTool(
          'FutureNativeProcessTool',
          { command: 'synthetic' },
          { toolUseID: id },
        ),
      ).resolves.toMatchObject({ behavior: 'deny' });
      expect(state.approvalRequests).toContain(id);
    },
  );

  test('known native tools do not acquire a new PreToolUse ask', async () => {
    const options = await loadOptions('allow-edits');
    const hook = getPreToolUseHook(options);
    for (const toolName of ['Read', 'Write', 'Bash', 'Agent']) {
      await expect(hookDecision(hook, toolName)).resolves.toEqual({});
    }
  });

  test('configured external and reserved internal MCP names bypass unknown-native forcing', async () => {
    const options = await loadOptions('allow-edits');
    const hook = getPreToolUseHook(options);
    const canUseTool = options.canUseTool as CanUseTool;

    for (const toolName of [
      'mcp__context7__resolve-library-id',
      'mcp__harness-tools__hostTool',
    ]) {
      await expect(hookDecision(hook, toolName)).resolves.toEqual({});
      await expect(
        canUseTool(toolName, {}, { toolUseID: toolName }),
      ).resolves.toMatchObject({ behavior: 'allow' });
      expect(state.approvalRequests).not.toContain(toolName);
    }
  });

  test('unconfigured mcp-like names are unknown and remain approval-gated', async () => {
    const options = await loadOptions('allow-edits');
    const hook = getPreToolUseHook(options);
    const toolName = 'mcp__not-configured__dangerous';
    await expect(hookDecision(hook, toolName)).resolves.toMatchObject({
      hookSpecificOutput: { permissionDecision: 'ask' },
    });
    const canUseTool = options.canUseTool as CanUseTool;
    await expect(
      canUseTool(toolName, {}, { toolUseID: 'unconfigured' }),
    ).resolves.toMatchObject({ behavior: 'deny' });
    expect(state.approvalRequests).toContain('unconfigured');
  });

  test('allow-all retains bypass behavior and does not force unknown asks', async () => {
    const options = await loadOptions('allow-all');
    const hook = getPreToolUseHook(options);
    await expect(
      hookDecision(hook, 'FutureNativeProcessTool'),
    ).resolves.toEqual({});
    expect(options.permissionMode).toBe('bypassPermissions');
    expect(options.allowDangerouslySkipPermissions).toBe(true);
    expect(options.canUseTool).toBeUndefined();
  });
});

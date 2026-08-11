import { createClaudeCode } from '../claude-code-harness';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type QueryArgs = {
  options: Record<string, unknown>;
};

type ToolUseKind = 'readonly' | 'edit' | 'bash';

type CatalogTool = {
  nativeName?: string;
  toolUseKind?: ToolUseKind;
};

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
        return { approved: false, reason: 'denied' };
      },
    });
  },
}));

function catalogEntries(): Array<{
  key: string;
  nativeName: string;
  kind: ToolUseKind;
}> {
  const tools = createClaudeCode().builtinTools as Record<string, CatalogTool>;

  return Object.entries(tools).flatMap(([key, tool]) => {
    if (tool.toolUseKind == null) return [];
    return [
      {
        key,
        nativeName: tool.nativeName ?? key,
        kind: tool.toolUseKind,
      },
    ];
  });
}

async function loadOptions(
  permissionMode: 'allow-reads' | 'allow-edits',
): Promise<Record<string, unknown>> {
  state.start = {
    prompt: 'Inspect the project.',
    thinking: { type: 'disabled' },
    permissionMode,
  };

  await import('./index');
  const options = state.queryArgs[0]?.options;
  expect(options).toBeDefined();
  return options!;
}

function askRules(options: Record<string, unknown>): string[] {
  const settings = options.settings as
    | { permissions?: { ask?: string[] } }
    | undefined;
  return settings?.permissions?.ask ?? [];
}

describe('Claude public catalog / bridge permission-kind parity', () => {
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

  test('allow-reads callback matches every explicitly declared public tool kind', async () => {
    const declared = catalogEntries();
    const options = await loadOptions('allow-reads');
    const canUseTool = options.canUseTool as CanUseTool;

    expect(declared.length).toBeGreaterThan(0);

    for (const entry of declared) {
      const result = await canUseTool(
        entry.nativeName,
        {},
        { toolUseID: `allow-reads:${entry.nativeName}` },
      );
      const expected = entry.kind === 'readonly' ? 'allow' : 'deny';
      expect.soft(
        result.behavior,
        `${entry.key} (${entry.nativeName}) public kind=${entry.kind}`,
      ).toBe(expected);
    }
  });

  test('allow-edits callback matches every explicitly declared public tool kind', async () => {
    const declared = catalogEntries();
    const options = await loadOptions('allow-edits');
    const canUseTool = options.canUseTool as CanUseTool;

    for (const entry of declared) {
      const result = await canUseTool(
        entry.nativeName,
        {},
        { toolUseID: `allow-edits:${entry.nativeName}` },
      );
      const expected = entry.kind === 'bash' ? 'deny' : 'allow';
      expect.soft(
        result.behavior,
        `${entry.key} (${entry.nativeName}) public kind=${entry.kind}`,
      ).toBe(expected);
    }
  });

  test('generated ask rules include every explicitly declared bash tool in allow-edits', async () => {
    const declared = catalogEntries();
    const options = await loadOptions('allow-edits');
    const rules = new Set(askRules(options));

    for (const entry of declared.filter(entry => entry.kind === 'bash')) {
      expect.soft(
        rules.has(`${entry.nativeName}(*)`),
        `${entry.key} (${entry.nativeName}) should have a bash-class ask rule`,
      ).toBe(true);
    }
  });

  test('generated ask rules include every explicitly declared edit/bash tool in allow-reads', async () => {
    const declared = catalogEntries();
    const options = await loadOptions('allow-reads');
    const rules = new Set(askRules(options));

    for (const entry of declared.filter(entry => entry.kind !== 'readonly')) {
      expect.soft(
        rules.has(`${entry.nativeName}(*)`),
        `${entry.key} (${entry.nativeName}) public kind=${entry.kind} should ask in allow-reads`,
      ).toBe(true);
    }
  });
});

import { createClaudeCode } from './claude-code-harness';
import { CLAUDE_CODE_NATIVE_TOOL_KINDS } from './bridge/native-tool-kinds';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type QueryArgs = {
  options: Record<string, unknown>;
};

type ToolUseKind = 'readonly' | 'edit' | 'bash';

type CatalogTool = {
  nativeName?: string;
  toolUseKind?: ToolUseKind;
};

type CatalogEntry = {
  key: string;
  nativeName: string;
  declaredKind?: ToolUseKind;
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

function catalogEntries(): CatalogEntry[] {
  const tools = createClaudeCode().builtinTools as Record<string, CatalogTool>;

  return Object.entries(tools).map(([key, tool]) => ({
    key,
    nativeName: tool.nativeName ?? key,
    declaredKind: tool.toolUseKind,
  }));
}

function mappedKind(entry: CatalogEntry): ToolUseKind {
  const kind = CLAUDE_CODE_NATIVE_TOOL_KINDS[entry.nativeName];
  expect.soft(
    kind,
    `${entry.key} (${entry.nativeName}) must have a shared permission kind`,
  ).toBeDefined();
  return kind!;
}

async function loadOptions(
  permissionMode: 'allow-reads' | 'allow-edits',
): Promise<Record<string, unknown>> {
  state.start = {
    prompt: 'Inspect the project.',
    thinking: { type: 'disabled' },
    permissionMode,
  };

  await import('./bridge/index');
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

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
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

  test('shared map covers the complete public native catalog and preserves every declared kind', () => {
    const catalog = catalogEntries();
    const catalogNames = new Set(catalog.map(entry => entry.nativeName));
    const mappedNames = new Set(Object.keys(CLAUDE_CODE_NATIVE_TOOL_KINDS));

    expect(catalog.length).toBeGreaterThan(0);
    expect(sorted(mappedNames)).toEqual(sorted(catalogNames));

    for (const entry of catalog) {
      const kind = mappedKind(entry);
      if (entry.declaredKind !== undefined) {
        expect.soft(
          kind,
          `${entry.key} (${entry.nativeName}) declared kind must match shared kind`,
        ).toBe(entry.declaredKind);
      }
    }
  });

  test('allow-reads callback matches the shared kind for every public built-in', async () => {
    const catalog = catalogEntries();
    const options = await loadOptions('allow-reads');
    const canUseTool = options.canUseTool as CanUseTool;

    for (const entry of catalog) {
      const kind = mappedKind(entry);
      const result = await canUseTool(
        entry.nativeName,
        {},
        { toolUseID: `allow-reads:${entry.nativeName}` },
      );
      const expected = kind === 'readonly' ? 'allow' : 'deny';
      expect.soft(
        result.behavior,
        `${entry.key} (${entry.nativeName}) shared kind=${kind}`,
      ).toBe(expected);
    }
  });

  test('allow-edits callback matches the shared kind for every public built-in', async () => {
    const catalog = catalogEntries();
    const options = await loadOptions('allow-edits');
    const canUseTool = options.canUseTool as CanUseTool;

    for (const entry of catalog) {
      const kind = mappedKind(entry);
      const result = await canUseTool(
        entry.nativeName,
        {},
        { toolUseID: `allow-edits:${entry.nativeName}` },
      );
      const expected = kind === 'bash' ? 'deny' : 'allow';
      expect.soft(
        result.behavior,
        `${entry.key} (${entry.nativeName}) shared kind=${kind}`,
      ).toBe(expected);
    }
  });

  test('allow-edits ask rules exactly match bash-class public built-ins', async () => {
    const catalog = catalogEntries();
    const options = await loadOptions('allow-edits');
    const expected = catalog
      .filter(entry => mappedKind(entry) === 'bash')
      .map(entry => `${entry.nativeName}(*)`);

    expect(sorted(askRules(options))).toEqual(sorted(expected));
  });

  test('allow-reads ask rules exactly match edit/bash public built-ins', async () => {
    const catalog = catalogEntries();
    const options = await loadOptions('allow-reads');
    const expected = catalog
      .filter(entry => mappedKind(entry) !== 'readonly')
      .map(entry => `${entry.nativeName}(*)`);

    expect(sorted(askRules(options))).toEqual(sorted(expected));
  });

  test('Agent remains approval-gated in allow-edits even when requesting bypassPermissions', async () => {
    const options = await loadOptions('allow-edits');
    const canUseTool = options.canUseTool as CanUseTool;
    const result = await canUseTool(
      'Agent',
      {
        description: 'Inspect delegated work.',
        prompt: 'Inspect the project.',
        mode: 'bypassPermissions',
      },
      { toolUseID: 'allow-edits:Agent' },
    );

    expect(result.behavior).toBe('deny');
    expect(state.approvalRequests).toContain('allow-edits:Agent');
    expect(askRules(options)).toContain('Agent(*)');
  });
});

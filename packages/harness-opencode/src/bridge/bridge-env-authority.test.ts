import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  launchEnv: undefined as NodeJS.ProcessEnv | undefined,
  originalArgv: [] as string[],
  originalEnv: {} as Record<string, string | undefined>,
}));

vi.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeServer: async () => {
    state.launchEnv = { ...process.env };
    throw new Error('stop after environment capture');
  },
  createOpencodeClient: () => ({}),
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
        model: 'openai/gpt-5.5',
        permissionMode: 'allow-all',
      },
      {
        emit: () => {},
        requestToolResult: async () => ({ output: {} }),
        requestToolApproval: async () => ({ approved: true }),
        abortSignal: new AbortController().signal,
        pendingUserMessages: [],
        emitWarning: () => {},
        emitError: () => {},
      },
    );
  },
}));

describe('OpenCode bridge transport credential isolation', () => {
  const keys = [
    'BRIDGE_CHANNEL_TOKEN',
    'BRIDGE_WS_PORT',
    'APPLICATION_ENV',
    'OPENAI_API_KEY',
  ] as const;

  beforeEach(() => {
    state.launchEnv = undefined;
    state.originalArgv = [...process.argv];
    state.originalEnv = Object.fromEntries(
      keys.map(key => [key, process.env[key]]),
    );

    process.env.BRIDGE_CHANNEL_TOKEN = 'synthetic-bridge-secret';
    process.env.BRIDGE_WS_PORT = '4319';
    process.env.APPLICATION_ENV = 'staging';
    process.env.OPENAI_API_KEY = 'synthetic-provider-key';

    process.argv.splice(
      0,
      process.argv.length,
      'node',
      'bridge.mjs',
      '--workdir',
      '/tmp/harness-opencode-test/work',
      '--bridge-state-dir',
      '/tmp/harness-opencode-test/state',
      '--bootstrap-dir',
      '/tmp/harness-opencode-test/bootstrap',
    );
  });

  afterEach(() => {
    process.argv.splice(0, process.argv.length, ...state.originalArgv);
    for (const key of keys) {
      const value = state.originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.resetModules();
  });

  test('preserves application/provider env while withholding bridge transport credentials from the OpenCode server launch', async () => {
    await import('./index');

    expect(state.launchEnv).toMatchObject({
      APPLICATION_ENV: 'staging',
      OPENAI_API_KEY: 'synthetic-provider-key',
    });
    expect(state.launchEnv).not.toHaveProperty('BRIDGE_CHANNEL_TOKEN');
    expect(state.launchEnv).not.toHaveProperty('BRIDGE_WS_PORT');

    // The bridge itself must retain its transport credentials after the child
    // launch boundary is crossed.
    expect(process.env.BRIDGE_CHANNEL_TOKEN).toBe('synthetic-bridge-secret');
    expect(process.env.BRIDGE_WS_PORT).toBe('4319');
  });
});

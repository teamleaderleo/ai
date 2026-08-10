import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type CodexOptions = {
  env?: Record<string, string>;
};

const state = vi.hoisted(() => ({
  codexOptions: [] as CodexOptions[],
  originalArgv: [] as string[],
  originalEnv: {} as Record<string, string | undefined>,
}));

vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    constructor(options: CodexOptions) {
      state.codexOptions.push(options);
    }

    startThread() {
      return {
        runStreamed: async () => ({
          events: (async function* () {
            yield { type: 'turn.completed' };
          })(),
        }),
      };
    }

    resumeThread() {
      return this.startThread();
    }
  },
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
        model: 'gpt-5.5',
      },
      {
        emit: () => {},
        requestToolResult: async () => ({ output: {} }),
        abortSignal: new AbortController().signal,
        pendingUserMessages: [],
        emitWarning: () => {},
        emitError: () => {},
      },
    );
  },
}));

describe('Codex bridge transport credential isolation', () => {
  const keys = [
    'BRIDGE_CHANNEL_TOKEN',
    'BRIDGE_WS_PORT',
    'APPLICATION_ENV',
    'OPENAI_API_KEY',
  ] as const;

  beforeEach(() => {
    state.codexOptions = [];
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
      '/tmp/harness-codex-test/work',
      '--bridge-state-dir',
      '/tmp/harness-codex-test/state',
      '--cli-shim-dir',
      '/tmp/harness-codex-test/shim',
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

  test('preserves application/provider env while withholding bridge transport credentials from Codex', async () => {
    await import('./index');

    expect(state.codexOptions).toHaveLength(1);
    const env = state.codexOptions[0]?.env;
    expect(env).toMatchObject({
      APPLICATION_ENV: 'staging',
      OPENAI_API_KEY: 'synthetic-provider-key',
    });
    expect(env).not.toHaveProperty('BRIDGE_CHANNEL_TOKEN');
    expect(env).not.toHaveProperty('BRIDGE_WS_PORT');
  });
});

import {
  HarnessCapabilityUnsupportedError,
  type HarnessV1NetworkSandboxSession,
} from '@ai-sdk/harness';
import { HarnessAgent } from '@ai-sdk/harness/agent';
import type * as HarnessUtils from '@ai-sdk/harness/utils';
import type * as NodeFsPromises from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodex } from './codex-harness';

const channelOptions: unknown[] = [];
const channelOpenInputs: unknown[] = [];
let openFailuresRemaining = 0;

vi.mock('@ai-sdk/harness/utils', async importOriginal => {
  const actual = await importOriginal<typeof HarnessUtils>();
  class FakeSandboxChannel {
    constructor(options: unknown) {
      channelOptions.push(options);
    }
    async open(input?: unknown): Promise<void> {
      channelOpenInputs.push(input);
      if (openFailuresRemaining > 0) {
        openFailuresRemaining--;
        throw new Error('bridge unavailable');
      }
    }
    on(): () => void {
      return () => {};
    }
    onClose(): void {}
    send(): void {}
    beginClose(): void {}
    isClosed(): boolean {
      return false;
    }
    suspend(): Promise<number> {
      return Promise.resolve(7);
    }
    close(): void {}
  }
  return { ...actual, SandboxChannel: FakeSandboxChannel };
});

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof NodeFsPromises>();
  return {
    ...actual,
    readFile: vi.fn(async (input: unknown, ...rest: unknown[]) => {
      const path = typeof input === 'string' ? input : String(input);
      if (path.endsWith('/bridge/index.mjs')) return '// mock bridge\n';
      if (path.endsWith('/bridge/package.json')) return '{"name":"mock"}';
      if (path.endsWith('/bridge/pnpm-lock.yaml'))
        return 'lockfileVersion: "9.0"\n';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (actual.readFile as any)(input, ...rest);
    }),
  };
});

function textStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (text.length > 0) {
        controller.enqueue(new TextEncoder().encode(text));
      }
      controller.close();
    },
  });
}

function fakeSandbox(options?: {
  spawnEnvs?: Array<Record<string, string | undefined>>;
  spawns?: string[];
}): HarnessV1NetworkSandboxSession {
  const spawns = options?.spawns ?? [];
  const session = {
    run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    readTextFile: async () => null,
    writeTextFile: async () => {},
    spawn: async ({
      command,
      env,
    }: {
      command: string;
      env?: Record<string, string | undefined>;
    }) => {
      spawns.push(command);
      if (env) options?.spawnEnvs?.push(env);
      return {
        stdout: textStream('{"type":"bridge-ready","port":4319}\n'),
        stderr: textStream(''),
        kill: async () => {},
        wait: async () => ({ exitCode: 0 }),
      };
    },
  };
  return {
    id: 'resumed-sandbox',
    defaultWorkingDirectory: '/vercel/sandbox',
    restricted: () => session,
    ports: [4319],
    async getPortUrl() {
      return 'ws://127.0.0.1:1';
    },
    async stop() {},
    ...session,
  } as unknown as HarnessV1NetworkSandboxSession;
}

function redactedData() {
  return {
    bridge: {
      port: 4319,
      lastSeenEventId: 7,
      sandboxId: 'stale-serialized-sandbox',
    },
  };
}

describe('Fieldwork: adapter-owned deterministic bridge-token reconstruction', () => {
  beforeEach(() => {
    channelOptions.length = 0;
    channelOpenInputs.length = 0;
    openFailuresRemaining = 0;
  });

  it('accepts redacted state and derives from the resumed sandbox id', async () => {
    const mintBridgeToken = vi.fn(
      (sandboxId: string) => `token-for-${sandboxId}`,
    );
    const codex = createCodex({ mintBridgeToken });
    const harness = { ...codex, getBootstrap: undefined };
    const sandboxSession = fakeSandbox();
    const resumeSession = vi.fn(async () => sandboxSession);
    const agent = new HarnessAgent({
      harness,
      sandbox: {
        specificationVersion: 'harness-sandbox-v1',
        providerId: 'sentinel-sandbox',
        createSession: vi.fn(async () => {
          throw new Error('fresh session should not be created');
        }),
        resumeSession,
      } as never,
    });

    const session = await agent.createSession({
      sessionId: 's1',
      resumeFrom: {
        type: 'resume-session',
        harnessId: 'codex',
        specificationVersion: 'harness-v1',
        data: redactedData(),
      },
    });

    expect(resumeSession).toHaveBeenCalledTimes(1);
    expect(mintBridgeToken).toHaveBeenCalledExactlyOnceWith('resumed-sandbox');
    expect(channelOptions.at(0)).toMatchObject({ initialLastSeenEventId: 7 });

    const detached = await session.detach();
    expect(detached.data).toMatchObject({
      bridge: { token: 'token-for-resumed-sandbox' },
    });
  });

  it('preserves the suspended-turn cursor when the token is redacted', async () => {
    const mintBridgeToken = vi.fn(() => 'derived-token');
    const session = await createCodex({ mintBridgeToken }).doStart({
      sessionId: 's1',
      sandboxSession: fakeSandbox(),
      sessionWorkDir: '/vercel/sandbox/codex-s1',
      continueFrom: {
        type: 'continue-turn',
        harnessId: 'codex',
        specificationVersion: 'harness-v1',
        data: redactedData(),
      },
    });

    expect(channelOptions.at(0)).toMatchObject({ initialLastSeenEventId: 7 });
    expect(channelOpenInputs.at(0)).toEqual({ resume: true });
    expect(mintBridgeToken).toHaveBeenCalledExactlyOnceWith('resumed-sandbox');
    await session.doDetach();
  });

  it('rejects redacted random-token state before attach or recovery drift', async () => {
    await expect(
      createCodex().doStart({
        sessionId: 's1',
        sandboxSession: fakeSandbox(),
        sessionWorkDir: '/vercel/sandbox/codex-s1',
        resumeFrom: {
          type: 'resume-session',
          harnessId: 'codex',
          specificationVersion: 'harness-v1',
          data: redactedData(),
        },
      }),
    ).rejects.toBeInstanceOf(HarnessCapabilityUnsupportedError);

    expect(channelOptions).toHaveLength(0);
  });

  it('reuses one derived token when live attach fails and respawn takes over', async () => {
    openFailuresRemaining = 1;
    const spawnEnvs: Array<Record<string, string | undefined>> = [];
    const spawns: string[] = [];
    const mintBridgeToken = vi.fn(
      (sandboxId: string) => `token-for-${sandboxId}`,
    );
    const session = await createCodex({ mintBridgeToken }).doStart({
      sessionId: 's1',
      sandboxSession: fakeSandbox({ spawnEnvs, spawns }),
      sessionWorkDir: '/vercel/sandbox/codex-s1',
      resumeFrom: {
        type: 'resume-session',
        harnessId: 'codex',
        specificationVersion: 'harness-v1',
        data: redactedData(),
      },
    });

    expect(mintBridgeToken).toHaveBeenCalledExactlyOnceWith('resumed-sandbox');
    expect(spawns).toHaveLength(1);
    expect(spawnEnvs.at(0)?.BRIDGE_CHANNEL_TOKEN).toBe(
      'token-for-resumed-sandbox',
    );
    await session.doDetach();
  });
});

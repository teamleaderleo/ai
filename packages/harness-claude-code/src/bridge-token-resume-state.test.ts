import type { HarnessV1NetworkSandboxSession } from '@ai-sdk/harness';
import type * as HarnessUtils from '@ai-sdk/harness/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openCalls: Array<{ resume?: boolean } | undefined> = [];

vi.mock('@ai-sdk/harness/utils', async importOriginal => {
  const actual = await importOriginal<typeof HarnessUtils>();
  class FakeSandboxChannel {
    async open(opts?: { resume?: boolean }): Promise<void> {
      openCalls.push(opts);
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

import { createClaudeCode } from './claude-code-harness';

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

function fakeSandbox({
  id,
  spawnEnvs = [],
}: {
  id: string;
  spawnEnvs?: Array<Record<string, string | undefined>>;
}): HarnessV1NetworkSandboxSession {
  const session = {
    run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    readTextFile: async () => null,
    spawn: async ({ env }: { env?: Record<string, string | undefined> }) => {
      if (env) spawnEnvs.push(env);
      return {
        stdout: textStream('{"type":"bridge-ready","port":4319}\n'),
        stderr: textStream(''),
        kill: async () => {},
        wait: async () => ({ exitCode: 0 }),
      };
    },
  };

  return {
    id,
    defaultWorkingDirectory: '/vercel/sandbox',
    restricted: () => session,
    ports: [4319],
    async getPortUrl() {
      return 'ws://127.0.0.1:4319';
    },
    async stop() {},
    ...session,
  } as unknown as HarnessV1NetworkSandboxSession;
}

describe('deterministic bridge token resume state', () => {
  beforeEach(() => {
    openCalls.length = 0;
  });

  it('omits the bridge credential from detach state when deterministic minting is configured', async () => {
    const spawnEnvs: Array<Record<string, string | undefined>> = [];
    const mintBridgeToken = vi.fn(
      (sandboxId: string) => `token-for-${sandboxId}`,
    );
    const harness = createClaudeCode({ mintBridgeToken });
    const sandboxSession = fakeSandbox({ id: 'sandbox-a', spawnEnvs });

    const session = await harness.doStart({
      sessionId: 'session-1',
      sandboxSession,
      sessionWorkDir: '/vercel/sandbox/session-1',
    });

    expect(spawnEnvs[0]?.BRIDGE_CHANNEL_TOKEN).toBe('token-for-sandbox-a');

    const resumeFrom = await session.doDetach();
    expect(resumeFrom.data).toEqual({
      bridge: {
        port: 4319,
        lastSeenEventId: 7,
        sandboxId: 'sandbox-a',
      },
    });
  });

  it('re-mints from the resumed sandbox identity when attaching secretless state', async () => {
    const mintBridgeToken = vi.fn(
      (sandboxId: string) => `token-for-${sandboxId}`,
    );
    const harness = createClaudeCode({ mintBridgeToken });
    const sandboxSession = fakeSandbox({ id: 'sandbox-a' });

    const resumeFrom = {
      type: 'resume-session' as const,
      harnessId: 'claude-code',
      specificationVersion: 'harness-v1' as const,
      data: {
        bridge: {
          port: 4319,
          lastSeenEventId: 7,
          sandboxId: 'sandbox-a',
        },
      },
    };

    const attachedSession = await harness.doStart({
      sessionId: 'session-1',
      sandboxSession,
      sessionWorkDir: '/vercel/sandbox/session-1',
      resumeFrom,
    });

    expect(mintBridgeToken).toHaveBeenCalledExactlyOnceWith('sandbox-a');
    expect(openCalls).toEqual([undefined]);
    await attachedSession.doDetach();
  });

  it('rejects live coordinates from a different sandbox identity', async () => {
    const mintBridgeToken = vi.fn(
      (sandboxId: string) => `token-for-${sandboxId}`,
    );
    const harness = createClaudeCode({ mintBridgeToken });
    const sandboxSession = fakeSandbox({ id: 'sandbox-b' });

    const resumeFrom = {
      type: 'resume-session' as const,
      harnessId: 'claude-code',
      specificationVersion: 'harness-v1' as const,
      data: {
        bridge: {
          port: 4319,
          lastSeenEventId: 7,
          sandboxId: 'sandbox-a',
        },
      },
    };

    await expect(
      harness.doStart({
        sessionId: 'session-1',
        sandboxSession,
        sessionWorkDir: '/vercel/sandbox/session-1',
        resumeFrom,
      }),
    ).rejects.toThrow('sandbox');
  });
});

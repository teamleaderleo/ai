import { HarnessAgent } from '@ai-sdk/harness/agent';
import { describe, expect, it, vi } from 'vitest';
import { createCodex } from './codex-harness';

describe('Fieldwork: deterministic bridge-token resume state', () => {
  it('requires callers to rehydrate a redacted live-bridge token before createSession', async () => {
    const mintBridgeToken = vi.fn(() => 'derived-token');
    const codex = createCodex({ mintBridgeToken });
    const harness = { ...codex, getBootstrap: undefined };
    const resumeSession = vi.fn(async () => {
      throw new Error('resume-session reached');
    });
    const sandbox = {
      specificationVersion: 'harness-sandbox-v1',
      providerId: 'sentinel-sandbox',
      createSession: vi.fn(async () => {
        throw new Error('fresh session should not be created');
      }),
      resumeSession,
    } as never;
    const agent = new HarnessAgent({ harness, sandbox });

    const redacted = {
      type: 'resume-session' as const,
      harnessId: 'codex',
      specificationVersion: 'harness-v1' as const,
      data: {
        bridge: {
          port: 4319,
          lastSeenEventId: 7,
          sandboxId: 'sandbox-1',
        },
      },
    };

    await expect(
      agent.createSession({
        sessionId: 's1',
        resumeFrom: redacted as never,
      }),
    ).rejects.toBeDefined();
    expect(resumeSession).not.toHaveBeenCalled();
    expect(mintBridgeToken).not.toHaveBeenCalled();

    const rehydrated = {
      ...redacted,
      data: {
        bridge: {
          ...redacted.data.bridge,
          token: 'derived-token',
        },
      },
    };

    await expect(
      agent.createSession({
        sessionId: 's1',
        resumeFrom: rehydrated,
      }),
    ).rejects.toThrow('resume-session reached');
    expect(resumeSession).toHaveBeenCalledTimes(1);
    expect(mintBridgeToken).not.toHaveBeenCalled();
  });
});

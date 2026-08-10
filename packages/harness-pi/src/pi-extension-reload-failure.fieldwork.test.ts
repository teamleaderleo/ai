import {
  DefaultResourceLoader,
  SettingsManager,
  type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  );
});

describe('Fieldwork: Pi inline-extension reload failure state', () => {
  it('reports loader state after a later inline factory invocation fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'fieldwork-pi-loader-'));
    roots.push(root);
    const cwd = path.join(root, 'work');
    const agentDir = path.join(root, 'agent');
    await Promise.all([
      mkdir(cwd, { recursive: true }),
      mkdir(agentDir, { recursive: true }),
    ]);

    let invocation = 0;
    const factory: ExtensionFactory = vi.fn(() => {
      invocation += 1;
      if (invocation === 2) {
        throw new Error('fieldwork extension reload failure');
      }
    });

    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: SettingsManager.inMemory(),
      extensionFactories: [factory],
      noExtensions: true,
      noThemes: true,
      noPromptTemplates: true,
    });

    await loader.reload();
    const first = loader.getExtensions();

    let settlement: 'resolved' | 'rejected' = 'resolved';
    let rejection: string | undefined;
    try {
      await loader.reload();
    } catch (error) {
      settlement = 'rejected';
      rejection = error instanceof Error ? error.message : String(error);
    }

    const second = loader.getExtensions();
    const observation = {
      invocation,
      settlement,
      rejection,
      firstErrors: first.errors.length,
      secondErrors: second.errors.length,
      sameRuntime: first.runtime === second.runtime,
      firstExtensions: first.extensions.length,
      secondExtensions: second.extensions.length,
    };

    console.log(`FIELDWORK_PI_RELOAD ${JSON.stringify(observation)}`);

    expect(invocation).toBe(2);
    expect(first.errors).toHaveLength(0);
  });
});

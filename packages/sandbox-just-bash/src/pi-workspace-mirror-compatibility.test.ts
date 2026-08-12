import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Experimental_SandboxSession } from '@ai-sdk/provider-utils';
import { Sandbox } from 'just-bash';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncHostWorkspaceFromSandbox } from '../../harness-pi/src/pi-workspace-mirror';
import { JustBashSandboxSession } from './just-bash-sandbox-session';

function withCommandTransform(
  sandbox: JustBashSandboxSession,
  transform: (command: string) => string,
): Experimental_SandboxSession {
  return new Proxy(sandbox, {
    get(target, property, receiver) {
      if (property === 'run') {
        return async (options: Parameters<typeof target.run>[0]) =>
          target.run({
            ...options,
            command: transform(options.command),
          });
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Experimental_SandboxSession;
}

async function expectMissing(path: string): Promise<void> {
  await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('Fieldwork #897: Pi workspace mirror with just-bash', () => {
  let sandbox: JustBashSandboxSession;
  let hostWorkDir: string;

  beforeEach(async () => {
    sandbox = new JustBashSandboxSession(
      await Sandbox.create({ cwd: '/workspace' }),
    );
    hostWorkDir = await mkdtemp(join(tmpdir(), 'ai-sdk-pi-just-bash-'));

    const setup = await sandbox.run({
      command: [
        'mkdir -p /workspace/.pi',
        "printf 'PI_SYSTEM_SENTINEL' > /workspace/.pi/SYSTEM.md",
        "printf 'ROOT_CONTEXT_SENTINEL' > /workspace/AGENTS.md",
      ].join(' && '),
    });
    expect(setup.exitCode).toBe(0);
  });

  afterEach(async () => {
    await rm(hostWorkDir, { recursive: true, force: true });
  });

  it('silently drops .pi files while a root context file still mirrors', async () => {
    await syncHostWorkspaceFromSandbox({
      sandbox,
      sandboxWorkDir: '/workspace',
      hostWorkDir,
    });

    await expect(readFile(join(hostWorkDir, 'AGENTS.md'), 'utf8')).resolves.toBe(
      'ROOT_CONTEXT_SENTINEL',
    );
    await expectMissing(join(hostWorkDir, '.pi', 'SYSTEM.md'));
  });

  it('still hides the inner find failure when only pipefail is enabled', async () => {
    const pipefailSandbox = withCommandTransform(
      sandbox,
      command => `set -o pipefail\n${command}`,
    );

    await syncHostWorkspaceFromSandbox({
      sandbox: pipefailSandbox,
      sandboxWorkDir: '/workspace',
      hostWorkDir,
    });

    await expectMissing(join(hostWorkDir, '.pi', 'SYSTEM.md'));
  });

  it('surfaces the unsupported find predicate when inner and pipeline failures propagate', async () => {
    const guardedSandbox = withCommandTransform(sandbox, command => {
      const guardedFinds = command.replace(
        /(find -L [^;\n]+); fi;/g,
        '$1 || exit $?; fi;',
      );
      return `set -o pipefail\n${guardedFinds}`;
    });

    await expect(
      syncHostWorkspaceFromSandbox({
        sandbox: guardedSandbox,
        sandboxWorkDir: '/workspace',
        hostWorkDir,
      }),
    ).rejects.toThrow("find: unknown predicate '-L'");
  });
});

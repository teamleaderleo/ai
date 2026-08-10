import type { HarnessV1NetworkSandboxSession } from '@ai-sdk/harness';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const piMock = vi.hoisted(() => ({
  extensionErrors: [] as Array<{ path: string; error: string }>,
}));

vi.mock('@earendil-works/pi-coding-agent', () => {
  return {
    createAgentSession: vi.fn(),
    DefaultResourceLoader: class {
      private extensionsResult = {
        errors: [] as Array<{ path: string; error: string }>,
        extensions: [],
        runtime: { flagValues: new Map() },
      };

      constructor(
        private readonly options: {
          extensionFactories?: Array<(api: unknown) => unknown>;
          extensionsOverride?: (extensions: unknown) => unknown;
        },
      ) {}

      async reload() {
        const errors: Array<{ path: string; error: string }> = [];
        for (const [index, factory] of (
          this.options.extensionFactories ?? []
        ).entries()) {
          try {
            await factory({});
          } catch (error) {
            errors.push({
              path: `<inline:${index}>`,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        piMock.extensionErrors = errors;
        const base = {
          errors,
          extensions: [],
          runtime: { flagValues: new Map() },
        };
        this.extensionsResult =
          (this.options.extensionsOverride?.(base) as typeof base) ?? base;
      }

      getExtensions() {
        return this.extensionsResult;
      }
    },
    defineTool: vi.fn(tool => tool),
    ModelRegistry: class {
      getAll = vi.fn(() => []);
      registerProvider = vi.fn();
    },
    ModelRuntime: {
      create: vi.fn(async () => ({
        setRuntimeApiKey: vi.fn(async () => {}),
      })),
    },
    SessionManager: {
      create: vi.fn(() => ({ getSessionFile: () => undefined })),
      open: vi.fn(() => ({ getSessionFile: () => undefined })),
    },
    SettingsManager: {
      inMemory: vi.fn(() => ({})),
      create: vi.fn(() => ({})),
    },
  };
});

import { createPi } from './pi-harness';

describe('Pi inline extension factory failures', () => {
  beforeEach(() => {
    piMock.extensionErrors = [];
  });

  it('surfaces a caller-supplied inline extension factory failure during session start', async () => {
    const factoryError = new Error('inline extension failed to initialize');
    let session:
      | Awaited<ReturnType<ReturnType<typeof createPi>['doStart']>>
      | undefined;
    let caught: unknown;

    try {
      session = await createPi({
        extensionFactories: [() => {
          throw factoryError;
        }],
      }).doStart({
        sessionId: 'session-inline-extension-error',
        sandboxSession: createSandboxSession(),
        sessionWorkDir: '/sandbox/work',
      });
    } catch (error) {
      caught = error;
    } finally {
      await session?.doDestroy();
    }

    expect(piMock.extensionErrors).toEqual([
      {
        path: '<inline:0>',
        error: 'inline extension failed to initialize',
      },
    ]);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(
      'inline extension failed to initialize',
    );
  });
});

function createSandboxSession(): HarnessV1NetworkSandboxSession {
  const sandbox = {
    defaultWorkingDirectory: '/sandbox',
    destroy: vi.fn(async () => {}),
    getPortUrl: vi.fn(),
    readBinaryFile: vi.fn(async () => undefined),
    restricted: vi.fn(() => sandbox),
    run: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    stop: vi.fn(async () => {}),
    writeBinaryFile: vi.fn(async () => {}),
    writeTextFile: vi.fn(async () => {}),
  };
  return sandbox as unknown as HarnessV1NetworkSandboxSession;
}

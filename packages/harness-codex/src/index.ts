import type { ZodType } from 'zod/v4';
import { createCodex as createCodexImplementation } from './codex-harness';
import type { CodexHarnessSettings } from './codex-harness';

/**
 * Create a Codex harness adapter.
 *
 * Deterministic bridge-token minting makes the live bearer token derivable
 * from the resumed sandbox identity. Those harness instances may therefore
 * accept lifecycle state with a redacted `bridge.token`; the adapter restores
 * it after the sandbox resumes. The default random-token harness keeps the
 * existing strict lifecycle contract and rejects a missing live token before
 * sandbox resume.
 */
export function createCodex(
  settings: CodexHarnessSettings = {},
): ReturnType<typeof createCodexImplementation> {
  const harness = createCodexImplementation(settings);

  if (settings.mintBridgeToken != null || harness.lifecycleStateSchema == null) {
    return harness;
  }

  // The Codex implementation owns this schema and currently uses Zod. Keep the
  // settings-dependent strictness local to the public package boundary rather
  // than widening the generic HarnessV1 lifecycle-schema contract.
  const lifecycleStateSchema = harness.lifecycleStateSchema as ZodType<unknown>;

  return {
    ...harness,
    lifecycleStateSchema: lifecycleStateSchema.refine(
      (data: unknown) => {
        if (data == null || typeof data !== 'object') return true;
        const bridge = (data as { bridge?: unknown }).bridge;
        if (bridge == null || typeof bridge !== 'object') return true;
        return (bridge as { token?: unknown }).token != null;
      },
      {
        message:
          'Codex live bridge resume state requires an authentication token when deterministic minting is not configured.',
        path: ['bridge', 'token'],
      },
    ),
  };
}

/**
 * Default `codex` harness instance with no overrides — suitable for the
 * common case where the underlying `codex` CLI's defaults are fine.
 * Equivalent to `createCodex()`.
 */
export const codex = createCodex();

export { VERSION } from './version';
export type { CodexHarnessSettings } from './codex-harness';
export type { CodexAuthOptions } from './codex-auth';

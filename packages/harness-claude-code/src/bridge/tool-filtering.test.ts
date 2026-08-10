import { describe, expect, it } from 'vitest';
import { createClaudeCode } from '../claude-code-harness';
import {
  resolveInactiveNativeTools,
  resolveNativeTools,
} from './tool-filtering';

describe('resolveNativeTools', () => {
  it('returns undefined without filtering', () => {
    expect(resolveNativeTools(undefined)).toBeUndefined();
  });

  it('maps allowlisted common tool names to native names', () => {
    expect(
      resolveNativeTools({ mode: 'allow', toolNames: ['read', 'Workflow'] }),
    ).toEqual(['Read', 'Workflow']);
  });

  it('preserves an empty allowlist', () => {
    expect(resolveNativeTools({ mode: 'allow', toolNames: [] })).toEqual([]);
  });

  it('returns undefined for deny filtering', () => {
    expect(
      resolveNativeTools({ mode: 'deny', toolNames: ['bash', 'Workflow'] }),
    ).toBeUndefined();
  });
});

describe('resolveInactiveNativeTools', () => {
  it('returns an empty list without filtering', () => {
    expect(resolveInactiveNativeTools(undefined)).toEqual([]);
  });

  it('maps denied common names and preserves native names', () => {
    expect(
      resolveInactiveNativeTools({
        mode: 'deny',
        toolNames: ['bash', 'Workflow'],
      }),
    ).toEqual(['Bash', 'Workflow']);
  });

  it('keeps the allow-mode inactive complement in parity with declared built-ins', () => {
    const harness = createClaudeCode();
    const expectedNativeNames = Object.entries(harness.builtinTools)
      .map(([publicName, builtin]) => builtin.nativeName ?? publicName)
      .sort();

    expect(
      resolveInactiveNativeTools({ mode: 'allow', toolNames: [] }).sort(),
    ).toEqual(expectedNativeNames);
  });
});

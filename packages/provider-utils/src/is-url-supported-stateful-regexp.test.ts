import { describe, expect, it } from 'vitest';
import { isUrlSupported } from './is-url-supported';

const url = 'https://example.com/asset';

describe('isUrlSupported with stateful regular expressions', () => {
  it('returns the same result for repeated global-regexp checks', () => {
    const pattern = /https:\/\/example\.com\/asset/g;
    const supportedUrls = { 'image/*': [pattern] };

    expect(
      Array.from({ length: 4 }, () =>
        isUrlSupported({ mediaType: 'image/png', url, supportedUrls }),
      ),
    ).toEqual([true, true, true, true]);
    expect(pattern.lastIndex).toBe(0);
  });

  it('returns the same result for repeated sticky-regexp checks', () => {
    const pattern = /https:\/\/example\.com\/asset/y;
    const supportedUrls = { 'image/*': [pattern] };

    expect(
      Array.from({ length: 4 }, () =>
        isUrlSupported({ mediaType: 'image/png', url, supportedUrls }),
      ),
    ).toEqual([true, true, true, true]);
    expect(pattern.lastIndex).toBe(0);
  });

  it('does not depend on or mutate caller-owned lastIndex', () => {
    const globalPattern = /https:\/\/example\.com\/asset/g;
    const stickyPattern = /https:\/\/example\.com\/asset/y;
    globalPattern.lastIndex = 7;
    stickyPattern.lastIndex = 11;

    expect(
      isUrlSupported({
        mediaType: 'image/png',
        url,
        supportedUrls: { 'image/*': [globalPattern, stickyPattern] },
      }),
    ).toBe(true);
    expect(globalPattern.lastIndex).toBe(7);
    expect(stickyPattern.lastIndex).toBe(11);

    expect(
      isUrlSupported({
        mediaType: 'image/png',
        url,
        supportedUrls: { 'image/*': [stickyPattern] },
      }),
    ).toBe(true);
    expect(globalPattern.lastIndex).toBe(7);
    expect(stickyPattern.lastIndex).toBe(11);
  });

  it('preserves state for non-matching patterns', () => {
    const pattern = /https:\/\/other\.example\/asset/g;
    pattern.lastIndex = 5;

    expect(
      isUrlSupported({
        mediaType: 'image/png',
        url,
        supportedUrls: { 'image/*': [pattern] },
      }),
    ).toBe(false);
    expect(pattern.lastIndex).toBe(5);
  });

  it('preserves frozen non-stateful regexp behavior', () => {
    const pattern = /https:\/\/example\.com\/asset/;
    pattern.lastIndex = 5;
    Object.freeze(pattern);

    expect(
      isUrlSupported({
        mediaType: 'image/png',
        url,
        supportedUrls: { 'image/*': [pattern] },
      }),
    ).toBe(true);
    expect(pattern.lastIndex).toBe(5);
  });
});

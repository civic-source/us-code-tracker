import { describe, it, expect } from 'vitest';

import { isPlTag, parsePlTag, sortPlTags } from '../lib/pl-tags.js';

describe('isPlTag', () => {
  it('accepts strictly well-formed pl tags', () => {
    expect(isPlTag('pl-117-159')).toBe(true);
    expect(isPlTag('pl-1-1')).toBe(true);
    expect(isPlTag('pl-118-22')).toBe(true);
  });

  it('rejects tags carrying shell metacharacters (injection guard)', () => {
    // git refs legally permit $, backtick, ;, (, ) — these must never pass.
    expect(isPlTag('pl-1-1$(touch /tmp/pwned)')).toBe(false);
    expect(isPlTag('pl-1-1;id')).toBe(false);
    expect(isPlTag('pl-1-1`id`')).toBe(false);
    expect(isPlTag('pl-1-1|whoami')).toBe(false);
  });

  it('rejects malformed but pl-prefixed names', () => {
    expect(isPlTag('pl-117-159-extra')).toBe(false);
    expect(isPlTag('pl-1')).toBe(false);
    expect(isPlTag('pl--1')).toBe(false);
    expect(isPlTag('pl-a-b')).toBe(false);
    expect(isPlTag('notpl-1-1')).toBe(false);
    expect(isPlTag('')).toBe(false);
  });
});

describe('parsePlTag', () => {
  it('parses congress and law for well-formed tags', () => {
    expect(parsePlTag('pl-117-159')).toEqual([117, 159]);
    expect(parsePlTag('pl-1-1')).toEqual([1, 1]);
  });

  it('returns [0, 0] for malformed / injection tags (anchored, no partial match)', () => {
    expect(parsePlTag('pl-1-1$(id)')).toEqual([0, 0]);
    expect(parsePlTag('pl-117-159-extra')).toEqual([0, 0]);
    expect(parsePlTag('readme')).toEqual([0, 0]);
  });
});

describe('sortPlTags', () => {
  it('drops malformed/hostile tags and sorts by (congress, law)', () => {
    const raw = ['pl-118-2', 'pl-117-159', 'pl-1-1$(id)', 'readme', 'pl-117-30'];
    expect(sortPlTags(raw)).toEqual(['pl-117-30', 'pl-117-159', 'pl-118-2']);
  });

  it('returns empty when no entry is a valid pl tag', () => {
    expect(sortPlTags(['', 'foo', 'pl-x-y', 'pl-1'])).toEqual([]);
  });
});

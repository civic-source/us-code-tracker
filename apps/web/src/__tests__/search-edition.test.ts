import { describe, expect, it } from 'vitest';
import { searchEditionScope } from '../lib/search-edition';

describe('same-edition search scope', () => {
  it('keeps requested old or unavailable editions instead of silently searching current law', () => {
    expect(searchEditionScope('pl-119-73', 'pl-119-142')).toBe('pl-119-73');
    expect(searchEditionScope('pl-118-1', 'pl-119-142')).toBe('pl-118-1');
    expect(searchEditionScope('bad edition', 'pl-119-142')).toBe('unavailable');
    expect(searchEditionScope(null, '')).toBe('unavailable');
  });
  it('maps only the accepted current edition or an absent query to current scope', () => {
    expect(searchEditionScope('PL-119-142', 'pl-119-142')).toBe('current');
    expect(searchEditionScope(null, 'pl-119-142')).toBe('current');
  });
});

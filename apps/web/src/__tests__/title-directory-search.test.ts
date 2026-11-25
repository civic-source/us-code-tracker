import { describe, expect, it } from 'vitest';
import { filterTitles, readDirectoryState, writeDirectoryState } from '../lib/title-directory-search';

const titles = [
  { num: '18', name: 'Crimes and Criminal Procedure', category: 'Judiciary & Criminal Law' },
  { num: '26', name: 'Internal Revenue Code', category: 'Commerce, Tax & Finance' },
] as const;

describe('title directory search', () => {
  it('finds the collected Internal Revenue title by the common subject Tax', () => {
    expect(filterTitles(titles, ' Tax ', 'All')).toEqual([titles[1]]);
  });
});


it('shares and restores the selected subject and category through the directory URL', () => {
  const state = { query: 'Tax', category: 'Commerce, Tax & Finance' } as const;
  const url = writeDirectoryState(new URL('https://example.test/us-code-tracker/browse/'), state);
  expect(url.searchParams.get('q')).toBe('Tax');
  expect(url.searchParams.get('category')).toBe('Commerce, Tax & Finance');
  expect(readDirectoryState(url)).toEqual(state);
});

it('keeps category restrictions while matching aliases and leaves the input unchanged', () => {
  expect(filterTitles(titles, 'Tax', 'Judiciary & Criminal Law')).toEqual([]);
  expect(filterTitles(titles, '', 'All')).toEqual(titles);
  expect(titles).toHaveLength(2);
});

it('resets only directory filters and preserves release and fragment context', () => {
  const url = new URL('https://example.test/browse/?release=pl-119-73&q=Tax&category=Commerce%2C+Tax+%26+Finance#scope');
  expect(writeDirectoryState(url, { query: '', category: 'All' }).href)
    .toBe('https://example.test/browse/?release=pl-119-73#scope');
  expect(readDirectoryState(new URL('https://example.test/browse/?q=Tax&category=unknown')))
    .toEqual({ query: 'Tax', category: 'All' });
});

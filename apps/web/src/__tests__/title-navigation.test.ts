import { describe, expect, it } from 'vitest';
import { titleNavigation } from '../lib/title-navigation';

describe('typed title navigation', () => {
  it('preserves alphanumeric identifiers and exposes uncollected/reserved entries without links', () => {
    const entries = titleNavigation(['18', '26', '18a']);
    expect(entries.find(entry => entry.id === '18a')).toMatchObject({ available: true });
    expect(entries.find(entry => entry.id === '53')).toMatchObject({ available: false });
    expect(entries.find(entry => entry.id === '5a')).toMatchObject({ available: false });
    expect(entries.every(entry => entry.id !== 'NaN')).toBe(true);
    expect(entries.findIndex(entry => entry.id === '18a')).toBe(entries.findIndex(entry => entry.id === '18') + 1);
  });
});

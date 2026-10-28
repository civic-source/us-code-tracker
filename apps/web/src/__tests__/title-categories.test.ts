import { describe, expect, it } from 'vitest';
import { getTitleCategory, TITLE_CATEGORIES } from '../data/title-categories';

describe('title-categories', () => {
  it('maps known criminal and judiciary titles correctly', () => {
    expect(getTitleCategory('18')).toBe('Judiciary & Criminal Law');
    expect(getTitleCategory('28')).toBe('Judiciary & Criminal Law');
    expect(getTitleCategory('34')).toBe('Judiciary & Criminal Law');
  });

  it('maps known commerce and tax titles correctly', () => {
    expect(getTitleCategory('26')).toBe('Commerce, Tax & Finance');
    expect(getTitleCategory('11')).toBe('Commerce, Tax & Finance');
    expect(getTitleCategory('35')).toBe('Commerce, Tax & Finance');
  });

  it('maps known administration and defense titles correctly', () => {
    expect(getTitleCategory('5')).toBe('Administration & Governance');
    expect(getTitleCategory('10')).toBe('Defense, Security & Foreign Affairs');
    expect(getTitleCategory('50')).toBe('Defense, Security & Foreign Affairs');
  });

  it('falls back to Administration & Governance for unknown titles', () => {
    expect(getTitleCategory('999')).toBe('Administration & Governance');
  });

  it('covers major U.S. Code titles', () => {
    expect(Object.keys(TITLE_CATEGORIES).length).toBeGreaterThanOrEqual(50);
  });
});

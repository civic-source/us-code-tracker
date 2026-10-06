import { describe, it, expect } from 'vitest';
import { compareSectionNumbers } from '../sort.js';

describe('compareSectionNumbers', () => {
  it('handles identical section numbers', () => {
    expect(compareSectionNumbers('101', '101')).toBe(0);
    expect(compareSectionNumbers('2000e-1', '2000e-1')).toBe(0);
  });

  it('orders basic numeric sections correctly', () => {
    const sections = ['10', '2', '1', '20', '3'];
    expect([...sections].sort(compareSectionNumbers)).toEqual(['1', '2', '3', '10', '20']);
  });

  it('correctly orders Title 42 Section 2000e series without scientific notation corruption', () => {
    // Under parseFloat('2000e-1'), JavaScript evaluates this as 2000 * 10^-1 = 200,
    // which incorrectly placed 2000e-1 before section 1000!
    const sections = ['200', '2000a', '2000e', '2000e-1', '2000e-2', '2000f', '2001'];
    expect([...sections].sort(compareSectionNumbers)).toEqual([
      '200',
      '2000a',
      '2000e',
      '2000e-1',
      '2000e-2',
      '2000f',
      '2001',
    ]);
  });

  it('correctly handles letter suffixes', () => {
    const sections = ['102', '101b', '101', '101a'];
    expect([...sections].sort(compareSectionNumbers)).toEqual(['101', '101a', '101b', '102']);
  });

  it('correctly handles hyphenated section numbers', () => {
    const sections = ['2', '1-2', '1', '1-1'];
    expect([...sections].sort(compareSectionNumbers)).toEqual(['1', '1-1', '1-2', '2']);
  });
});

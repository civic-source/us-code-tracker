import { describe, it, expect } from 'vitest';
import { normalizeCitation, deduplicateCases } from '../citation-utils.js';
import type { PrecedentAnnotation } from '@civic-source/types';

type CaseAnnotation = PrecedentAnnotation['cases'][number];

function makeCase(overrides: Partial<CaseAnnotation> = {}): CaseAnnotation {
  return {
    caseName: 'Doe v. United States',
    citation: '18 U.S.C. 111',
    court: 'SCOTUS',
    date: '2024-01-15',
    holdingSummary: 'The court held broadly.',
    sourceUrl: 'https://www.courtlistener.com/opinion/12345/',
    impact: 'interpretation',
    ...overrides,
  };
}

describe('normalizeCitation', () => {
  it('collapses multiple whitespace', () => {
    expect(normalizeCitation('18  U.S.C.   111')).toBe('18 usc 111');
  });

  it('standardizes § to Section', () => {
    expect(normalizeCitation('18 USC §111')).toBe('18 usc section 111');
    expect(normalizeCitation('18 USC § 111')).toBe('18 usc section 111');
  });

  it('standardizes U.S.C. to USC', () => {
    expect(normalizeCitation('18 U.S.C. 111')).toBe('18 usc 111');
  });

  it('lowercases the result', () => {
    expect(normalizeCitation('SCOTUS Case 123')).toBe('scotus case 123');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeCitation('  18 USC 111  ')).toBe('18 usc 111');
  });

  it('handles combined normalization', () => {
    // "18 U.S.C. § 111" should match "18 USC Section 111"
    expect(normalizeCitation('18 U.S.C. § 111')).toBe('18 usc section 111');
    expect(normalizeCitation('18 USC Section 111')).toBe('18 usc section 111');
  });
});

describe('deduplicateCases', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateCases([])).toEqual([]);
  });

  it('preserves unique cases', () => {
    const cases = [
      makeCase({ citation: '18 USC 111' }),
      makeCase({ citation: '42 USC 1983' }),
    ];
    expect(deduplicateCases(cases)).toHaveLength(2);
  });

  it('removes exact duplicate citations', () => {
    const cases = [
      makeCase({ caseName: 'First', citation: '18 USC 111' }),
      makeCase({ caseName: 'Second', citation: '18 USC 111' }),
    ];
    const result = deduplicateCases(cases);
    expect(result).toHaveLength(1);
    expect(result[0]?.caseName).toBe('First');
  });

  it('deduplicates normalized matches', () => {
    const cases = [
      makeCase({ caseName: 'First', citation: '18 U.S.C. § 111' }),
      makeCase({ caseName: 'Second', citation: '18 USC Section 111' }),
    ];
    const result = deduplicateCases(cases);
    expect(result).toHaveLength(1);
    expect(result[0]?.caseName).toBe('First');
  });

  it('preserves first occurrence on dedup', () => {
    const cases = [
      makeCase({ caseName: 'Alpha', citation: '18  U.S.C.  111' }),
      makeCase({ caseName: 'Beta', citation: '18 U.S.C. 111' }),
      makeCase({ caseName: 'Gamma', citation: '42 USC 1983' }),
    ];
    const result = deduplicateCases(cases);
    expect(result).toHaveLength(2);
    expect(result[0]?.caseName).toBe('Alpha');
    expect(result[1]?.caseName).toBe('Gamma');
  });

  it('handles mixed § and Section in dedup', () => {
    const cases = [
      makeCase({ citation: '26 U.S.C. §501' }),
      makeCase({ citation: '26 USC Section 501' }),
      makeCase({ citation: '26 U.S.C. § 501' }),
    ];
    const result = deduplicateCases(cases);
    expect(result).toHaveLength(1);
  });

  it('retains distinct cases that both have empty citations', () => {
    const cases = [
      makeCase({
        caseName: 'Alpha v. United States',
        citation: '',
        date: '2024-01-15',
        sourceUrl: 'https://www.courtlistener.com/opinion/111/',
      }),
      makeCase({
        caseName: 'Beta v. United States',
        citation: '',
        date: '2023-06-30',
        sourceUrl: 'https://www.courtlistener.com/opinion/222/',
      }),
    ];
    const result = deduplicateCases(cases);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.caseName)).toEqual([
      'Alpha v. United States',
      'Beta v. United States',
    ]);
  });

  it('still collapses truly identical uncited cases', () => {
    const cases = [
      makeCase({ caseName: 'Same', citation: '', date: '2024-01-15', sourceUrl: 'https://www.courtlistener.com/opinion/999/' }),
      makeCase({ caseName: 'Same', citation: '', date: '2024-01-15', sourceUrl: 'https://www.courtlistener.com/opinion/999/' }),
    ];
    const result = deduplicateCases(cases);
    expect(result).toHaveLength(1);
  });

  it('collapses cases with the same non-empty citation while retaining distinct uncited ones', () => {
    const cases = [
      makeCase({ caseName: 'CitedFirst', citation: '18 USC 111' }),
      makeCase({ caseName: 'CitedSecond', citation: '18 U.S.C. 111' }),
      makeCase({ caseName: 'UncitedA', citation: '', sourceUrl: 'https://www.courtlistener.com/opinion/aaa/' }),
      makeCase({ caseName: 'UncitedB', citation: '', sourceUrl: 'https://www.courtlistener.com/opinion/bbb/' }),
    ];
    const result = deduplicateCases(cases);
    // One collapsed cited case + two distinct uncited cases = 3
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.caseName)).toEqual(['CitedFirst', 'UncitedA', 'UncitedB']);
  });
});

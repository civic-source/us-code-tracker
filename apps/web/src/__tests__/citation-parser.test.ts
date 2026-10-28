import { describe, expect, it } from 'vitest';
import { parseCitation } from '../lib/citation-parser';

describe('citation-parser', () => {
  it('parses standard USC citations', () => {
    expect(parseCitation('18 usc 111')).toEqual({
      title: '18',
      section: '111',
      display: '18 U.S.C. § 111',
    });

    expect(parseCitation('42 U.S.C. § 1983')).toEqual({
      title: '42',
      section: '1983',
      display: '42 U.S.C. § 1983',
    });

    expect(parseCitation('26 U.S.C. 501')).toEqual({
      title: '26',
      section: '501',
      display: '26 U.S.C. § 501',
    });
  });

  it('parses verbose title/section format', () => {
    expect(parseCitation('title 18 section 1001')).toEqual({
      title: '18',
      section: '1001',
      display: '18 U.S.C. § 1001',
    });

    expect(parseCitation('Title 5 § 552')).toEqual({
      title: '5',
      section: '552',
      display: '5 U.S.C. § 552',
    });
  });

  it('parses shorthand colon and symbol notations', () => {
    expect(parseCitation('18:111')).toEqual({
      title: '18',
      section: '111',
      display: '18 U.S.C. § 111',
    });

    expect(parseCitation('18 § 111')).toEqual({
      title: '18',
      section: '111',
      display: '18 U.S.C. § 111',
    });
  });

  it('handles alphanumeric sections and titles', () => {
    expect(parseCitation('18a usc 1')).toEqual({
      title: '18a',
      section: '1',
      display: '18A U.S.C. § 1',
    });
  });

  it('returns null for non-citations or arbitrary text', () => {
    expect(parseCitation('freedom of speech')).toBeNull();
    expect(parseCitation('habeas corpus')).toBeNull();
    expect(parseCitation('')).toBeNull();
  });
});

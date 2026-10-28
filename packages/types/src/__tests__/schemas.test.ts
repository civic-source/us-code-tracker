import { describe, it, expect } from 'vitest';
import {
  ReleasePointSchema,
  CaseAnnotationSchema,
  PrecedentAnnotationSchema,
  PrecedentImpactSchema,
  ImplementingRegulationSchema,
  SectionRegulationsSchema,
  LegislativeHistoryItemSchema,
  SectionLegislativeHistorySchema,
  ok,
  err,
} from '../index.js';

describe('Result helpers', () => {
  it('ok wraps a value', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it('err wraps an error', () => {
    const result = err(new Error('fail'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('fail');
  });
});

describe('ReleasePointSchema', () => {
  const valid = {
    title: '18',
    publicLaw: 'PL 119-73',
    dateET: '2026-01-15T12:00:00Z',
    uslmUrl: 'https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_usc18@119-73.zip',
    sha256Hash: 'a'.repeat(64),
  };

  it('accepts a valid release point', () => {
    expect(ReleasePointSchema.parse(valid)).toEqual(valid);
  });

  it('rejects empty title', () => {
    expect(() => ReleasePointSchema.parse({ ...valid, title: '' })).toThrow();
  });

  it('rejects invalid URL', () => {
    expect(() => ReleasePointSchema.parse({ ...valid, uslmUrl: 'not-a-url' })).toThrow();
  });

  it('rejects non-http(s) uslmUrl schemes', () => {
    expect(() => ReleasePointSchema.parse({ ...valid, uslmUrl: 'javascript:alert(1)' })).toThrow();
    expect(() => ReleasePointSchema.parse({ ...valid, uslmUrl: 'ftp://uscode.house.gov/x.zip' })).toThrow();
  });

  it('rejects wrong-length sha256Hash', () => {
    expect(() => ReleasePointSchema.parse({ ...valid, sha256Hash: 'abc' })).toThrow();
  });

  it('rejects invalid dateET format', () => {
    expect(() => ReleasePointSchema.parse({ ...valid, dateET: 'March 15' })).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => ReleasePointSchema.parse({ title: '1' })).toThrow();
  });
});

describe('PrecedentImpactSchema', () => {
  it('accepts valid impacts', () => {
    for (const impact of ['interpretation', 'unconstitutional', 'narrowed', 'historical']) {
      expect(PrecedentImpactSchema.parse(impact)).toBe(impact);
    }
  });

  it('rejects invalid impact', () => {
    expect(() => PrecedentImpactSchema.parse('overturned')).toThrow();
  });
});

describe('CaseAnnotationSchema', () => {
  const valid = {
    caseName: 'United States v. Smith',
    citation: '500 U.S. 123 (2020)',
    court: 'SCOTUS' as const,
    date: '2020-06-15',
    holdingSummary: 'Held that the statute applies to federal officers.',
    sourceUrl: 'https://courtlistener.com/opinion/12345/',
    impact: 'interpretation' as const,
  };

  it('accepts valid case annotation', () => {
    expect(CaseAnnotationSchema.parse(valid)).toEqual(valid);
  });

  it('accepts optional statuteVersionRef', () => {
    const withRef = { ...valid, statuteVersionRef: 'PL 117-81', statuteVersionNote: 'Current at time of decision' };
    expect(CaseAnnotationSchema.parse(withRef)).toEqual(withRef);
  });

  it('rejects invalid court', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, court: 'State' })).toThrow();
  });

  it('rejects a javascript: sourceUrl (would render as an href)', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, sourceUrl: 'javascript:alert(document.cookie)' })).toThrow();
  });

  it('accepts an empty string sourceUrl (fallback for unpinned or missing source URLs)', () => {
    const withEmpty = { ...valid, sourceUrl: '' };
    expect(CaseAnnotationSchema.parse(withEmpty).sourceUrl).toBe('');
  });

  it('rejects holdingSummary over 500 chars', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, holdingSummary: 'x'.repeat(501) })).toThrow();
  });

  it('accepts holdingSummary at exactly 500 chars', () => {
    const atLimit = { ...valid, holdingSummary: 'x'.repeat(500) };
    expect(CaseAnnotationSchema.parse(atLimit).holdingSummary).toHaveLength(500);
  });

  // Length caps on untrusted strings that flow into the hand-rolled YAML
  // sidecar — fail-closed so nothing over-cap is ever serialized (#232).
  it('rejects caseName over 500 chars but accepts it at the cap', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, caseName: 'x'.repeat(501) })).toThrow();
    expect(CaseAnnotationSchema.parse({ ...valid, caseName: 'x'.repeat(500) }).caseName).toHaveLength(500);
  });

  it('rejects citation over 200 chars but accepts it at the cap', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, citation: 'x'.repeat(201) })).toThrow();
    expect(CaseAnnotationSchema.parse({ ...valid, citation: 'x'.repeat(200) }).citation).toHaveLength(200);
  });

  it('rejects statuteVersionRef over 100 chars', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, statuteVersionRef: 'x'.repeat(101) })).toThrow();
  });

  it('rejects statuteVersionNote over 500 chars', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, statuteVersionNote: 'x'.repeat(501) })).toThrow();
  });
});

describe('PrecedentAnnotationSchema', () => {
  it('accepts valid annotation with cases', () => {
    const annotation = {
      targetSection: '18 U.S.C. § 111',
      lastSyncedET: '2026-03-29T18:00:00Z',
      cases: [{
        caseName: 'United States v. Doe',
        citation: '600 U.S. 1 (2025)',
        court: 'SCOTUS' as const,
        date: '2025-01-01',
        holdingSummary: 'Test holding',
        sourceUrl: 'https://example.com/case',
        impact: 'interpretation' as const,
      }],
    };
    const result = PrecedentAnnotationSchema.parse(annotation);
    expect(result.cases).toHaveLength(1);
    expect(result.targetSection).toBe('18 U.S.C. § 111');
  });

  it('accepts empty cases array', () => {
    const annotation = {
      targetSection: '26 U.S.C. § 1',
      lastSyncedET: '2026-01-01T00:00:00Z',
      cases: [],
    };
    expect(PrecedentAnnotationSchema.parse(annotation).cases).toHaveLength(0);
  });

  it('rejects invalid lastSyncedET', () => {
    expect(() => PrecedentAnnotationSchema.parse({
      targetSection: 'test',
      lastSyncedET: 'not-a-date',
      cases: [],
    })).toThrow();
  });
});

describe('ImplementingRegulationSchema & SectionRegulationsSchema', () => {
  const validReg = {
    cfrTitle: 40,
    cfrPart: 50,
    agency: 'Environmental Protection Agency',
    description: 'National Primary and Secondary Ambient Air Quality Standards',
    ecfrUrl: 'https://www.ecfr.gov/current/title-40/part-50',
  };

  it('accepts valid implementing regulation', () => {
    expect(ImplementingRegulationSchema.parse(validReg)).toEqual(validReg);
  });

  it('rejects invalid ecfrUrl scheme', () => {
    expect(() => ImplementingRegulationSchema.parse({ ...validReg, ecfrUrl: 'javascript:alert(1)' })).toThrow();
  });

  it('accepts valid section regulations container', () => {
    const container = {
      targetSection: '42-7401',
      lastUpdated: '2026-03-30T00:00:00Z',
      regulations: [validReg],
    };
    expect(SectionRegulationsSchema.parse(container)).toEqual(container);
  });
});

describe('LegislativeHistoryItemSchema & SectionLegislativeHistorySchema', () => {
  const validHistory = {
    publicLaw: 'PL 104-132',
    congress: 104,
    billNumber: 'S. 735',
    enactedDate: '1996-04-24',
    crsSummary: 'Antiterrorism and Effective Death Penalty Act of 1996.',
    statutesAtLargeCitation: '110 Stat. 1214',
    statutesAtLargeUrl: 'https://www.govinfo.gov/link/statute/110/1214',
    committeeReports: [
      {
        reportNumber: 'H. Rept. 104-518',
        chamber: 'Conference' as const,
        url: 'https://www.govinfo.gov/content/pkg/CRPT-104hrpt518/pdf/CRPT-104hrpt518.pdf',
      },
    ],
  };

  it('accepts valid legislative history item', () => {
    expect(LegislativeHistoryItemSchema.parse(validHistory)).toEqual(validHistory);
  });

  it('accepts valid section legislative history container', () => {
    const container = {
      targetSection: '18-2332b',
      lastUpdated: '2026-03-30T00:00:00Z',
      history: [validHistory],
    };
    expect(SectionLegislativeHistorySchema.parse(container)).toEqual(container);
  });
});

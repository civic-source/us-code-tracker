import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchImplementingRegulations,
  fetchRegulationsWithOutcome,
  authorityTextCitesSection,
} from '../extract-regulations.js';

describe('USCT-002 & USCT-003: fetchRegulationsWithOutcome & fetchImplementingRegulations', () => {
  const fixedNow = '2026-11-21T12:00:00.000Z';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('labels eCFR search hits as unverified text_match_candidate by default (USCT-003)', async () => {
    const mockApiResponse = {
      results: [
        {
          hierarchy: { title: '40', part: '50' },
          headings: {
            title: 'Protection of Environment',
            chapter: 'Environmental Protection Agency',
            part: 'Air Quality Standards',
          },
          full_text_excerpt: 'Pursuant to 42 U.S.C. 7401, national ambient air quality standards...',
        },
        {
          hierarchy: { title: '40', part: '50' }, // Duplicate title/part
          headings: { title: 'Protection of Environment', chapter: 'EPA', part: 'Air Quality Standards' },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
    } as unknown as Response);

    const outcome = await fetchRegulationsWithOutcome(42, '7401', { nowIso: fixedNow });

    expect(outcome.status).toBe('success-nonempty');
    expect(outcome.isStale).toBe(false);
    expect(outcome.retainedPriorSnapshot).toBe(false);
    expect(outcome.data).toHaveLength(1);
    expect(outcome.data[0]).toEqual({
      cfrTitle: 40,
      cfrPart: 50,
      agency: 'Environmental Protection Agency',
      description: 'Air Quality Standards',
      ecfrUrl: 'https://www.ecfr.gov/current/title-40/part-50',
      extractionState: 'candidate',
      editorialReview: 'unreviewed',
      relationshipType: 'text_match_candidate',
      discoveryQuery: '"42 U.S.C. 7401"',
      matchingEvidence: 'Pursuant to 42 U.S.C. 7401, national ambient air quality standards...',
      verifiedAuthorityText: undefined,
      retrievedAt: fixedNow,
    });
  });

  it('promotes only independently verified authority citations while keeping incidental mentions as candidates (USCT-003 / USCT-014)', async () => {
    const mockApiResponse = {
      results: [
        {
          hierarchy: { title: '40', part: '50' },
          headings: { chapter: 'Environmental Protection Agency', part: 'Air Quality Standards' },
          full_text_excerpt: 'Authority: 42 U.S.C. 7401 et seq.',
        },
        {
          hierarchy: { title: '29', part: '1910' },
          headings: { chapter: 'OSHA', part: 'Occupational Safety' },
          full_text_excerpt: 'Cross-referencing 42 U.S.C. 7401 air definitions in passing.',
        },
        {
          hierarchy: { title: '7', part: '1' },
          headings: { chapter: 'USDA', part: 'Administrative Regulations' },
          full_text_excerpt: 'Unrelated match mentioning 42 U.S.C. 74010.',
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
    } as unknown as Response);

    const authorityMap: Record<string, string> = {
      '40-50': 'Authority: 42 U.S.C. 7401-7671q.',
      '29-1910': 'Authority: 29 U.S.C. 655.',
      '7-1': 'Authority: 5 U.S.C. 301; 42 U.S.C. 74010.',
    };

    const outcome = await fetchRegulationsWithOutcome(42, '7401', {
      nowIso: fixedNow,
      verifyAuthority: (t, p) => authorityMap[`${t}-${p}`] ?? null,
    });

    expect(outcome.status).toBe('success-nonempty');
    expect(outcome.data).toHaveLength(3);

    // 40 CFR Part 50 has verified authority citing 42 U.S.C. 7401 (machine verification defaults editorialReview to 'unreviewed')
    expect(outcome.data[0]?.extractionState).toBe('verified');
    expect(outcome.data[0]?.relationshipType).toBe('authority_citation');
    expect(outcome.data[0]?.editorialReview).toBe('unreviewed');
    expect(outcome.data[0]?.verifiedAuthorityText).toBe('Authority: 42 U.S.C. 7401-7671q.');

    // 29 CFR Part 1910 is an incidental text mention (authority is 29 U.S.C. 655)
    expect(outcome.data[1]?.extractionState).toBe('candidate');
    expect(outcome.data[1]?.relationshipType).toBe('text_match_candidate');
    expect(outcome.data[1]?.verifiedAuthorityText).toBeUndefined();

    // 7 CFR Part 1 cites 42 U.S.C. 74010 (different section number) — must not false-match 7401
    expect(outcome.data[2]?.extractionState).toBe('candidate');
    expect(outcome.data[2]?.relationshipType).toBe('text_match_candidate');
    expect(outcome.data[2]?.verifiedAuthorityText).toBeUndefined();
  });

  it('distinguishes 200-empty from 429, 500, timeout, malformed payload, and pagination failure while retaining prior snapshot (USCT-002)', async () => {
    const prior = {
      data: [
        {
          cfrTitle: 40,
          cfrPart: 50,
          agency: 'Environmental Protection Agency',
          ecfrUrl: 'https://www.ecfr.gov/current/title-40/part-50',
          extractionState: 'candidate' as const,
          editorialReview: 'unreviewed' as const,
          relationshipType: 'text_match_candidate' as const,
        },
      ],
      lastSuccessAt: '2026-10-01T00:00:00.000Z',
    };

    // 1. 200-empty (genuine zero matches)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    } as unknown as Response);
    const emptyRes = await fetchRegulationsWithOutcome(18, '111', { nowIso: fixedNow, priorSnapshot: prior });
    expect(emptyRes.status).toBe('success-empty');
    expect(emptyRes.data).toEqual([]);
    expect(emptyRes.retainedPriorSnapshot).toBe(false);
    expect(emptyRes.isStale).toBe(false);

    // 2. HTTP 429 rate limited -> retains prior snapshot & marks stale
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    } as unknown as Response);
    const rateLimited = await fetchRegulationsWithOutcome(42, '7401', { nowIso: fixedNow, priorSnapshot: prior });
    expect(rateLimited.status).toBe('failed');
    expect(rateLimited.failureKind).toBe('rate_limited');
    expect(rateLimited.retainedPriorSnapshot).toBe(true);
    expect(rateLimited.isStale).toBe(true);
    expect(rateLimited.data).toEqual(prior.data);

    // 3. HTTP 500 server error -> retains prior snapshot
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response);
    const serverErr = await fetchRegulationsWithOutcome(42, '7401', { nowIso: fixedNow, priorSnapshot: prior });
    expect(serverErr.status).toBe('failed');
    expect(serverErr.failureKind).toBe('http_error');
    expect(serverErr.retainedPriorSnapshot).toBe(true);
    expect(serverErr.data).toEqual(prior.data);

    // 4. Timeout / network error
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Request timeout after 15000ms'));
    const timeoutErr = await fetchRegulationsWithOutcome(42, '7401', { nowIso: fixedNow, priorSnapshot: prior });
    expect(timeoutErr.status).toBe('failed');
    expect(timeoutErr.failureKind).toBe('timeout');
    expect(timeoutErr.retainedPriorSnapshot).toBe(true);
    expect(timeoutErr.data).toEqual(prior.data);

    // 5. Malformed payload
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ unexpected: 'shape' }),
    } as unknown as Response);
    const malformed = await fetchRegulationsWithOutcome(42, '7401', { nowIso: fixedNow, priorSnapshot: prior });
    expect(malformed.status).toBe('failed');
    expect(malformed.failureKind).toBe('malformed_payload');
    expect(malformed.retainedPriorSnapshot).toBe(true);

    // 6. Pagination failure -> partial status
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ hierarchy: { title: '40', part: '50' }, headings: { chapter: 'EPA' } }],
        meta: { current_page: 1, total_pages: 3, page_failure: true },
      }),
    } as unknown as Response);
    const partial = await fetchRegulationsWithOutcome(42, '7401', { nowIso: fixedNow, priorSnapshot: prior });
    expect(partial.status).toBe('partial');
    expect(partial.failureKind).toBe('pagination_incomplete');
    expect(partial.isStale).toBe(true);
    expect(partial.completedPages).toBe(1);
    expect(partial.expectedPages).toBe(3);
  });

  it('authorityTextCitesSection matches exact section numbers without partial prefix collisions', () => {
    expect(authorityTextCitesSection('Authority: 42 U.S.C. 7401-7671q.', 42, '7401')).toBe(true);
    expect(authorityTextCitesSection('Authority: 18 U.S.C. § 111.', 18, '111')).toBe(true);
    expect(authorityTextCitesSection('Authority: 18 U.S.C. 1114.', 18, '111')).toBe(false);
    expect(authorityTextCitesSection('Authority: 42 U.S.C. 7401a.', 42, '7401')).toBe(false);
  });

  it('routes removed/expired eCFR parts to historical /on/{date}/ URLs via ends_on', async () => {
    const mockApiResponse = {
      results: [
        {
          hierarchy: { title: '32', part: '584' },
          headings: { chapter: 'Department of the Army', part: 'Family Support' },
          ends_on: '2019-11-11',
          full_text_excerpt: 'Section 13 reference...',
        },
        {
          hierarchy: { title: '32', part: '999' },
          headings: { chapter: 'Removed Without Date' },
          removed: true,
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
    } as unknown as Response);

    const outcome = await fetchRegulationsWithOutcome(18, '13', { nowIso: fixedNow });
    expect(outcome.status).toBe('success-nonempty');
    expect(outcome.data).toHaveLength(1);
    expect(outcome.data[0]?.ecfrUrl).toBe('https://www.ecfr.gov/on/2019-11-10/title-32/part-584');
  });

  it('legacy fetchImplementingRegulations returns empty array when API fails without prior snapshot', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response);

    const results = await fetchImplementingRegulations(18, '111');
    expect(results).toEqual([]);
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger } from '@civic-source/shared';

import { CourtListenerClient, isCourtListenerResult } from '../client.js';

const VALID = {
  caseName: 'Doe v. United States',
  citation: ['123 U.S. 456'],
  court: 'scotus',
  dateFiled: '2024-01-15',
  snippet: 'The court held that the statute applies broadly.',
  absolute_url: '/opinion/12345/doe-v-united-states/',
};

describe('isCourtListenerResult (#237)', () => {
  it('accepts a fully-formed result', () => {
    expect(isCourtListenerResult(VALID)).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isCourtListenerResult(null)).toBe(false);
    expect(isCourtListenerResult('x')).toBe(false);
    expect(isCourtListenerResult(undefined)).toBe(false);
  });

  it('rejects results missing or mistyping required fields', () => {
    const noSnippet: Record<string, unknown> = { ...VALID };
    delete noSnippet['snippet'];
    expect(isCourtListenerResult(noSnippet)).toBe(false);
    expect(isCourtListenerResult({ ...VALID, court: 123 })).toBe(false);
    expect(isCourtListenerResult({ ...VALID, citation: '123 U.S. 456' })).toBe(false); // not an array
    expect(isCourtListenerResult({ ...VALID, citation: [123] })).toBe(false); // non-string element
    expect(isCourtListenerResult({ ...VALID, absolute_url: null })).toBe(false);
  });
});

describe('CourtListenerClient.searchByStatute (#237)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFetchJson(body: unknown): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response)
    );
  }

  it('drops malformed result elements and returns only well-formed ones', async () => {
    const malformed = { caseName: 'Broken', court: 'scotus' }; // missing snippet/citation/etc.
    stubFetchJson({ count: 2, results: [VALID, malformed] });

    const client = new CourtListenerClient({ token: 't', logger: createLogger('test', 'error') });
    const result = await client.searchByStatute('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.caseName).toBe('Doe v. United States');
  });

  it('returns an empty list when the envelope has no results array', async () => {
    stubFetchJson({ detail: 'unexpected shape' });

    const client = new CourtListenerClient({ token: 't', logger: createLogger('test', 'error') });
    const result = await client.searchByStatute('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});

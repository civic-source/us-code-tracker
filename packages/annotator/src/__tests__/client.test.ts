import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger } from '@civic-source/shared';

import { CourtListenerClient, isCourtListenerResult } from '../client.js';
import { COURTLISTENER_RATE_LIMITER, RATE_LIMIT_PER_HOUR } from '../constants.js';

describe('COURTLISTENER_RATE_LIMITER (#230)', () => {
  it('sustains exactly RATE_LIMIT_PER_HOUR tokens per hour (not the old ~7200)', () => {
    const perHour =
      (3_600_000 / COURTLISTENER_RATE_LIMITER.refillIntervalMs) * COURTLISTENER_RATE_LIMITER.refillRate;
    expect(perHour).toBeLessThanOrEqual(RATE_LIMIT_PER_HOUR);
    expect(perHour).toBe(RATE_LIMIT_PER_HOUR);
  });

  it('caps burst capacity at the hourly limit', () => {
    expect(COURTLISTENER_RATE_LIMITER.capacity).toBe(RATE_LIMIT_PER_HOUR);
  });
});

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

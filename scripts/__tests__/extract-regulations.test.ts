import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchImplementingRegulations } from '../extract-regulations.js';

describe('fetchImplementingRegulations', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and normalizes CFR parts from eCFR search API', async () => {
    const mockApiResponse = {
      results: [
        {
          hierarchy: { title: '40', part: '50' },
          headings: { title: 'Protection of Environment', chapter: 'Environmental Protection Agency', part: 'Air Quality Standards' },
        },
        {
          hierarchy: { title: '40', part: '50' }, // Duplicate title/part
          headings: { title: 'Protection of Environment', chapter: 'EPA', part: 'Air Quality Standards' },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse,
    } as any);

    const results = await fetchImplementingRegulations(42, '7401');

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      cfrTitle: 40,
      cfrPart: 50,
      agency: 'Environmental Protection Agency',
      description: 'Air Quality Standards',
      ecfrUrl: 'https://www.ecfr.gov/current/title-40/part-50',
    });
  });

  it('returns empty array when API request fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as any);

    const results = await fetchImplementingRegulations(18, '111');
    expect(results).toEqual([]);
  });

  it('handles network exceptions gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const results = await fetchImplementingRegulations(18, '111');
    expect(results).toEqual([]);
  });
});

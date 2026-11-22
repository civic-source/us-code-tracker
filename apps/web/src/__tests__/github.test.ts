import { describe, it, expect } from 'vitest';
import {
  sanitizeContent,
  sanitizeExcerpt,
  formatTagName,
  extractYear,
  isRateLimited,
  getPaginatedReleaseTags,
  getPaginatedFileHistory,
  parseReleaseTagParts,
} from '../lib/github';

describe('sanitizeContent', () => {
  it('strips basic HTML tags', () => {
    expect(sanitizeContent('<b>bold</b>')).toBe('bold');
  });

  it('strips script blocks entirely', () => {
    expect(sanitizeContent('before<script>alert("xss")</script>after')).toBe('beforeafter');
  });

  it('strips style blocks entirely', () => {
    expect(sanitizeContent('text<style>.evil{}</style>more')).toBe('textmore');
  });

  it('strips HTML comments', () => {
    expect(sanitizeContent('before<!-- hidden instruction -->after')).toBe('beforeafter');
  });

  it('keeps encoded entities encoded (cannot bypass the parser)', () => {
    // sanitize-html parses as HTML and preserves `&lt;` etc. as entities — so
    // the rendered output is literal text, never a re-parsed <script> element.
    const out = sanitizeContent('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });

  it('handles nested/malformed tags', () => {
    expect(sanitizeContent('<div><p>text</p></div>')).toBe('text');
  });

  it('returns plain text unchanged', () => {
    expect(sanitizeContent('just plain text')).toBe('just plain text');
  });
});

describe('sanitizeExcerpt', () => {
  it('preserves mark tags from Pagefind', () => {
    expect(sanitizeExcerpt('text <mark>match</mark> more')).toBe('text <mark>match</mark> more');
  });

  it('strips non-mark tags', () => {
    expect(sanitizeExcerpt('<b>bold</b> <mark>match</mark>')).toBe('bold <mark>match</mark>');
  });

  it('strips script blocks', () => {
    expect(sanitizeExcerpt('<mark>ok</mark><script>evil()</script>')).toBe('<mark>ok</mark>');
  });

  it('handles self-closing mark', () => {
    expect(sanitizeExcerpt('text <mark>highlighted</mark> end')).toBe('text <mark>highlighted</mark> end');
  });
});

describe('formatTagName', () => {
  it('formats pl-113-100 to PL 113-100', () => {
    expect(formatTagName('pl-113-100')).toBe('PL 113-100');
  });
});

describe('extractYear', () => {
  it('derives year from congress number', () => {
    expect(extractYear('', 'pl-113-100')).toBe('2013');
    expect(extractYear('', 'pl-119-73')).toBe('2025');
  });

  it('falls back to date string', () => {
    expect(extractYear('2024-06-15T00:00:00Z')).toBe('2024');
  });

  it('returns empty for no date and no tag', () => {
    expect(extractYear('')).toBe('');
  });
});

describe('isRateLimited', () => {
  it('detects 403 as rate limited', () => {
    expect(isRateLimited({ status: 403 })).toBe(true);
  });

  it('detects 429 as rate limited', () => {
    expect(isRateLimited({ status: 429 })).toBe(true);
  });

  it('returns false for 500', () => {
    expect(isRateLimited({ status: 500 })).toBe(false);
  });

  it('returns false for non-objects', () => {
    expect(isRateLimited('error')).toBe(false);
    expect(isRateLimited(null)).toBe(false);
  });
});

describe('USCT-007: Paginated release tag catalog & file commit history fallbacks', () => {
  it('retains all 103 synthetic release identities across multiple pages and orders exclusions/revisions', async () => {
    // Build an independently enumerated 103-release synthetic fixture spanning 113th-119th Congress
    // including exclusion (pl-119-73not60) and correction revision (pl-119-73-rev2) identities
    const syntheticReleases: Array<{ name: string; commit: { sha: string } }> = [];
    for (let i = 1; i <= 101; i++) {
      const congress = 113 + Math.floor((i - 1) / 15);
      const law = ((i - 1) % 15) + 1;
      syntheticReleases.push({
        name: `pl-${congress}-${law}`,
        commit: { sha: i.toString(16).padStart(40, '0') },
      });
    }
    syntheticReleases.push({
      name: 'pl-119-73not60',
      commit: { sha: 'a'.repeat(40) },
    });
    syntheticReleases.push({
      name: 'pl-119-73-rev2',
      commit: { sha: 'b'.repeat(40) },
    });
    expect(syntheticReleases).toHaveLength(103);

    const mockFetch: typeof fetch = async (input) => {
      const u = new URL(String(input));
      const perPage = parseInt(u.searchParams.get('per_page') ?? '100', 10);
      const page = parseInt(u.searchParams.get('page') ?? '1', 10);
      const start = (page - 1) * perPage;
      const slice = syntheticReleases.slice(start, start + perPage);
      return new Response(JSON.stringify(slice), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await getPaginatedReleaseTags('civic-source', 'us-code', {
      perPage: 100,
      fetchFn: mockFetch,
    });

    expect(result.completeness).toBe('complete');
    expect(result.pagesFetched).toBe(2);
    expect(result.items).toHaveLength(103);
    // Navigate to synthetic release 101+
    expect(result.items[100]).toBeDefined();
    expect(result.items.map((t) => t.name)).toContain('pl-119-73not60');
    expect(result.items.map((t) => t.name)).toContain('pl-119-73-rev2');
    expect(parseReleaseTagParts('pl-119-73not60').valid).toBe(true);
  });

  it('reports partial completeness when a later tag page fails or repeats duplicate items', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      name: `pl-115-${i + 1}`,
      commit: { sha: (i + 1).toString(16).padStart(40, '0') },
    }));

    // 1. Page 2 fails with HTTP 502 -> partial completeness, preserving page 1
    const failingPage2Fetch: typeof fetch = async (input) => {
      const u = new URL(String(input));
      const page = parseInt(u.searchParams.get('page') ?? '1', 10);
      if (page === 1) {
        return new Response(JSON.stringify(page1), { status: 200 });
      }
      return new Response('Bad Gateway', { status: 502 });
    };

    const failedPage2Result = await getPaginatedReleaseTags('civic-source', 'us-code', {
      perPage: 100,
      fetchFn: failingPage2Fetch,
    });
    expect(failedPage2Result.completeness).toBe('partial');
    expect(failedPage2Result.items).toHaveLength(100);
    expect(failedPage2Result.errorMessage).toContain('HTTP 502');

    // 2. Page 2 returns duplicate of Page 1 -> stops loop and reports partial
    const duplicatePageFetch: typeof fetch = async () => {
      return new Response(JSON.stringify(page1), { status: 200 });
    };

    const dupResult = await getPaginatedReleaseTags('civic-source', 'us-code', {
      perPage: 100,
      fetchFn: duplicatePageFetch,
    });
    expect(dupResult.completeness).toBe('partial');
    expect(dupResult.items).toHaveLength(100);
    expect(dupResult.duplicateItemsDropped).toBe(100);
    expect(dupResult.errorMessage).toContain('Duplicate tag page');
  });

  it('retains all 53 synthetic file-history commits across pages and detects failed final page', async () => {
    const syntheticCommits = Array.from({ length: 53 }, (_, i) => ({
      sha: (i + 1).toString(16).padStart(40, 'c'),
      commit: {
        message: `chore(law): Update to PL 116-${i + 1}\n\nDetails`,
        author: {
          date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
          name: 'OLRC Bot',
        },
      },
    }));

    const result = await getPaginatedFileHistory(
      'civic-source',
      'us-code',
      'statutes/title-18/chapter-7/section-111.md',
      {
        perPage: 50,
        listCommitsPage: async (page, perPage) => {
          const start = (page - 1) * perPage;
          return syntheticCommits.slice(start, start + perPage);
        },
      }
    );

    expect(result.completeness).toBe('complete');
    expect(result.pagesFetched).toBe(2);
    expect(result.items).toHaveLength(53);
    // Commit 51 is accessible
    expect(result.items[50]?.message).toBe('chore(law): Update to PL 116-51');

    // Simulate failure on page 2 after page 1 (50 commits) succeeded
    const partialCommits = await getPaginatedFileHistory(
      'civic-source',
      'us-code',
      'statutes/title-18/chapter-7/section-111.md',
      {
        perPage: 50,
        listCommitsPage: async (page) => {
          if (page === 1) return syntheticCommits.slice(0, 50);
          throw new Error('HTTP 503 Service Unavailable on page 2');
        },
      }
    );
    expect(partialCommits.completeness).toBe('partial');
    expect(partialCommits.items).toHaveLength(50);
    expect(partialCommits.errorMessage).toContain('page 2');
  });
});

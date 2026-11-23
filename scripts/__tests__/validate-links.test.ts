import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectSoft404,
  probeUrl,
  runLiveLinkValidation,
  runOfflineLinkValidation,
  validateExtractedUrl,
} from '../validate-links.js';

describe('validate-links', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeFixtureRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'usct-validate-links-'));
    tempDirs.push(dir);
    await mkdir(join(dir, 'apps/web/public/context'), { recursive: true });
    await mkdir(join(dir, 'apps/web/public/topics'), { recursive: true });
    await mkdir(join(dir, 'apps/web/content-data/statutes/title-18/chapter-47'), {
      recursive: true,
    });
    await writeFile(
      join(dir, 'apps/web/content-data/statutes/title-18/chapter-47/section-1001.md'),
      '# 18 U.S.C. 1001\n',
      'utf-8'
    );
    return dir;
  }

  describe('validateExtractedUrl & offline policy', () => {
    it('flags deprecated OLRC, DOJ typo, cleartext http, credentials, and javascript URIs', () => {
      expect(
        validateExtractedUrl(
          'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title10-section135&num=0&edition=prelim',
          'test.astro'
        )
      ).not.toBeNull();
      expect(
        validateExtractedUrl('https://uscode.house.gov/download/download.shtml', 'test.ts')
      ).not.toBeNull();
      expect(
        validateExtractedUrl('https://uscode.house.gov/codification/legislation.shtml', 'ctx.json')
      ).not.toBeNull();
      expect(
        validateExtractedUrl('https://www.justice.gov/jm/jm-9-42000-fraud-against-government', 'ctx.json')
      ).not.toBeNull();
      expect(validateExtractedUrl('http://example.org/foo', 'readme.md')).not.toBeNull();
      expect(validateExtractedUrl('http://example.org/${id}', 'template.ts')).not.toBeNull();
      expect(validateExtractedUrl('javascript:alert(1)', 'component.svelte')).not.toBeNull();
      expect(validateExtractedUrl('https://user:pass@uscode.house.gov/', 'test.ts')).not.toBeNull();
    });

    it('allows valid HTTPS URLs, standard XML namespace HTTP URIs, and template URLs', () => {
      expect(validateExtractedUrl('https://uscode.house.gov/us/usc/t10/s135/', 'slug.astro')).toBeNull();
      expect(
        validateExtractedUrl('https://www.justice.gov/jm/jm-9-42000-fraud-against-the-government', 'ctx.json')
      ).toBeNull();
      expect(validateExtractedUrl('http://xml.house.gov/schemas/uslm/1.0', 'slice.ts')).toBeNull();
      expect(
        validateExtractedUrl('https://www.govinfo.gov/link/uscode/${uscTitle}/${uscSection}', 'box.astro')
      ).toBeNull();
    });

    it('runs full offline validation across fixture repo and catches broken topic internal links', async () => {
      const repo = await makeFixtureRepo();
      await writeFile(
        join(repo, 'apps/web/public/context/agency-guidance.json'),
        JSON.stringify({
          records: [
            { url: 'https://www.justice.gov/jm/jm-9-42000-fraud-against-the-government' },
            { url: 'https://uscode.house.gov/codification/legislation.html' },
          ],
        }),
        'utf-8'
      );
      await writeFile(
        join(repo, 'apps/web/public/topics/index.json'),
        JSON.stringify({ topics: [{ topicSlug: 'false-statements' }] }),
        'utf-8'
      );
      await writeFile(
        join(repo, 'apps/web/public/topics/false-statements.json'),
        JSON.stringify({
          memberProvisions: [{ url: '/us-code-tracker/statute/title-18/chapter-47/section-1001/' }],
          relatedAuthorities: [{ sourceUrl: 'https://www.ecfr.gov/current/title-19/part-162' }],
        }),
        'utf-8'
      );

      const okRes = await runOfflineLinkValidation(repo);
      expect(okRes.ok).toBe(true);
      expect(okRes.issues).toEqual([]);
      expect(okRes.builderChecks).toBeGreaterThanOrEqual(50);

      // Now introduce a broken internal statute reference + deprecated URL
      await writeFile(
        join(repo, 'apps/web/public/topics/false-statements.json'),
        JSON.stringify({
          memberProvisions: [{ url: '/us-code-tracker/statute/title-18/chapter-47/section-999999/' }],
          relatedAuthorities: [{ sourceUrl: 'https://uscode.house.gov/download/download.shtml' }],
        }),
        'utf-8'
      );
      const failRes = await runOfflineLinkValidation(repo);
      expect(failRes.ok).toBe(false);
      expect(failRes.issues).toHaveLength(2);
    });
  });

  describe('detectSoft404', () => {
    it('flags explicit 404 titles, headings, and OLRC error messages', () => {
      expect(
        detectSoft404('<html><head><title>404 Not Found</title></head><body>Oops</body></html>')
      ).toBe(true);
      expect(
        detectSoft404('<html><body><p>The requested page does not exist on this server.</p></body></html>')
      ).toBe(true);
      expect(detectSoft404('<html><body><h1>Page Not Found</h1></body></html>')).toBe(true);
    });

    it('does not false-positive on § 404 / Part 404 titles or prose mentioning "not found"', () => {
      const legitStatute =
        '<html><head><title>18 U.S.C. 1001 - Statements or entries generally</title></head>' +
        '<body><p>Where a material fact is not found to have been concealed...</p></body></html>';
      expect(detectSoft404(legitStatute)).toBe(false);
      expect(
        detectSoft404('<html><head><title>18 U.S.C. § 404 — Civil Penalties</title></head><body>OK</body></html>')
      ).toBe(false);
      expect(
        detectSoft404('<html><head><title>20 CFR Part 404 — Federal Old-Age Insurance</title></head><body>OK</body></html>')
      ).toBe(false);
    });
  });

  describe('probeUrl & runLiveLinkValidation', () => {
    it('handles 200 OK, soft-404 fail, HEAD 405 -> GET fallback, and 202/429 throttling warnings', async () => {
      const soft404Res = await probeUrl(
        { url: 'https://uscode.house.gov/us/usc/t10/s135/', source: 'test', kind: 'html' },
        {
          fetchFn: async () =>
            new Response('<html><title>Page Not Found</title><body>does not exist</body></html>', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            }),
        }
      );
      expect(soft404Res.outcome.status).toBe('fail');
      expect(soft404Res.outcome.reason).toContain('Soft-404');

      const methods: string[] = [];
      const fallbackRes = await probeUrl(
        { url: 'https://www.govinfo.gov/link/uscode/10/135', source: 'test', kind: 'binary' },
        {
          fetchFn: async (_u, init) => {
            methods.push(init?.method ?? 'GET');
            return init?.method === 'HEAD'
              ? new Response('', { status: 405, statusText: 'Method Not Allowed' })
              : new Response('%PDF-1.4', { status: 200 });
          },
        }
      );
      expect(methods).toEqual(['HEAD', 'GET']);
      expect(fallbackRes.outcome.status).toBe('ok');

      const throttledRes = await probeUrl(
        { url: 'https://www.courtlistener.com/?q=18', source: 'test', kind: 'html' },
        {
          fetchFn: async () => new Response('', { status: 202, statusText: 'Accepted' }),
        }
      );
      expect(throttledRes.outcome.status).toBe('warn_throttled');
    });

    it('fails OLRC smoke check if download page yields fewer than 50 title links', async () => {
      const repo = await makeFixtureRepo();
      const emptyOlrcDownload = `
        <html><body>
          <h3 class="releasepointinformation">Public Law 119-142</h3>
          <p>Current through Public Law 119-142 (November 10, 2026).</p>
          <a href="download/releasepoints/us/pl/119/142/xml_usc01@119-142.zip">T1</a>
        </body></html>
      `;
      const result = await runLiveLinkValidation(repo, {
        retryDelayMs: 1,
        fetchFn: async (input) => {
          const url = String(input);
          if (url.endsWith('/download.html')) {
            return new Response(emptyOlrcDownload, { status: 200 });
          }
          if (url.endsWith('/priorreleasepoints.html')) {
            return new Response('<html><body>empty</body></html>', { status: 200 });
          }
          return new Response('<html><title>OK</title><body>valid</body></html>', { status: 200 });
        },
      });
      expect(result.ok).toBe(false);
      expect(result.outcomes.some((o) => o.source === 'parser:olrc_download' && o.status === 'fail')).toBe(
        true
      );
      expect(result.outcomes.some((o) => o.source === 'parser:olrc_prior' && o.status === 'fail')).toBe(
        true
      );
    }, 30_000);
  });
});

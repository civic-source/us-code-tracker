import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  OlrcFetcher,
  sha256,
  fetchWithRetry,
  parseReleasePoints,
  parsePriorReleasePoints,
  parseCurrentRelease,
} from '../fetcher.js';
import { HashStore } from '../hash-store.js';
import { createLogger } from '@civic-source/shared';
import type { ReleasePoint } from '@civic-source/types';

// --- sha256 ---

describe('sha256', () => {
  it('returns correct hex digest', () => {
    const buf = Buffer.from('hello');
    const expected = createHash('sha256').update(buf).digest('hex');
    expect(sha256(buf)).toBe(expected);
  });

  it('returns different hashes for different inputs', () => {
    expect(sha256(Buffer.from('a'))).not.toBe(sha256(Buffer.from('b')));
  });
});

// --- parseCurrentRelease ---

describe('parseCurrentRelease', () => {
  it('extracts public law and date from download page header', () => {
    const html = `<h2>Public Law 119-73 (01/23/2026)</h2>`;
    const result = parseCurrentRelease(html);
    expect(result).toBeDefined();
    expect(result?.publicLaw).toBe('PL 119-73');
    expect(result?.congress).toBe('119');
    expect(result?.law).toBe('73');
    expect(result?.dateET).toBe('2026-01-23T00:00:00.000Z');
  });

  it('returns undefined for HTML with no release info', () => {
    expect(parseCurrentRelease('<html><body>No info</body></html>')).toBeUndefined();
  });
});

// --- parsePriorReleasePoints ---

describe('parsePriorReleasePoints', () => {
  const sampleHtml = `
    <ul class="releasepoints">
      <li class="releasepoint">
        <a class="releasepoint" href="/download/releasepoints/us/pl/119/73not60/usc-rp@119-73not60.htm">
          Public Law 119-73 (01/23/2026)</a>
      </li>
      <li class="releasepoint">
        <a class="releasepoint" href="/download/releasepoints/us/pl/113/21/usc-rp@113-21.htm">
          Public Law 113-21 (07/18/2013)</a>
      </li>
      <li class="releasepoint">
        <a class="releasepoint" href="/download/releasepoints/us/pl/118/200/usc-rp@118-200.htm">
          Public Law 118-200 (11/15/2024)</a>
      </li>
    </ul>
  `;

  it('extracts all prior release points', () => {
    const points = parsePriorReleasePoints(sampleHtml);
    expect(points).toHaveLength(3);
  });

  it('parses publicLaw correctly', () => {
    const points = parsePriorReleasePoints(sampleHtml);
    expect(points[0]?.publicLaw).toBe('PL 113-21');
    expect(points[1]?.publicLaw).toBe('PL 118-200');
    expect(points[2]?.publicLaw).toBe('PL 119-73');
  });

  it('parses congress and law numbers', () => {
    const points = parsePriorReleasePoints(sampleHtml);
    // Sorted chronologically — oldest first
    expect(points[0]?.congress).toBe('113');
    expect(points[0]?.law).toBe('21');
  });

  it('converts dates to ISO 8601', () => {
    const points = parsePriorReleasePoints(sampleHtml);
    expect(points[0]?.dateET).toBe('2013-07-18T00:00:00.000Z');
    expect(points[2]?.dateET).toBe('2026-01-23T00:00:00.000Z');
  });

  it('returns chronological order (oldest first)', () => {
    const points = parsePriorReleasePoints(sampleHtml);
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      if (prev && curr) {
        expect(prev.dateET <= curr.dateET).toBe(true);
      }
    }
  });

  it('handles "not" exclusion paths', () => {
    const html = `
      <a class="releasepoint" href="/download/releasepoints/us/pl/119/73not60/usc-rp@119-73not60.htm">
        Public Law 119-73 (01/23/2026)</a>
    `;
    const points = parsePriorReleasePoints(html);
    expect(points).toHaveLength(1);
    expect(points[0]?.law).toBe('73not60');
    expect(points[0]?.path).toContain('73not60');
  });

  it('returns empty array for HTML with no matching links', () => {
    expect(parsePriorReleasePoints('<html><body>Nothing</body></html>')).toEqual([]);
  });
});

// --- parseReleasePoints ---

describe('parseReleasePoints', () => {
  it('extracts release points from HTML links with real publicLaw/dateET', () => {
    const html = `
      <h2>Public Law 118-200 (11/15/2024)</h2>
      <a href="/download/releasepoints/us/pl/118/200/xml_usc42@118-200.zip">Title 42</a>
      <a href="/download/releasepoints/us/pl/118/200/xml_usc26@118-200.zip">Title 26</a>
    `;
    const points = parseReleasePoints(html);
    expect(points).toHaveLength(2);
    expect(points[0]?.title).toBe('42');
    expect(points[0]?.publicLaw).toBe('PL 118-200');
    expect(points[0]?.dateET).toBe('2024-11-15T00:00:00.000Z');
    expect(points[0]?.uslmUrl).toContain('xml_usc42@118-200.zip');
    expect(points[1]?.title).toBe('26');
  });

  it('returns empty array for HTML with no matching links', () => {
    expect(parseReleasePoints('<html><body>Nothing here</body></html>')).toEqual([]);
  });

  it('handles titles with letter suffixes (e.g., 5a)', () => {
    const html = `
      <h2>Public Law 118-200 (11/15/2024)</h2>
      <a href="/download/releasepoints/us/pl/118/200/xml_usc5a@118-200.zip">Title 5a</a>
    `;
    const points = parseReleasePoints(html);
    expect(points).toHaveLength(1);
    expect(points[0]?.title).toBe('5a');
  });

  it('deduplicates titles (only one entry per title number)', () => {
    const html = `
      <h2>Public Law 118-200 (11/15/2024)</h2>
      <a href="/download/releasepoints/us/pl/118/200/xml_usc42@118-200.zip">XML</a>
      <a href="/download/releasepoints/us/pl/118/200/htm_usc42@118-200.zip">XHTML</a>
    `;
    const points = parseReleasePoints(html);
    expect(points).toHaveLength(1);
  });

  it('falls back to empty publicLaw when header is missing', () => {
    const html = `<a href="/download/releasepoints/us/pl/118/200/xml_usc01@118-200.zip">T1</a>`;
    const points = parseReleasePoints(html);
    expect(points).toHaveLength(1);
    expect(points[0]?.publicLaw).toBe('');
  });
});

// --- fetchWithRetry ---

describe('fetchWithRetry', () => {
  const logger = createLogger('test', 'error');

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns response on success', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

    const result = await fetchWithRetry('https://example.com', logger);
    expect(result.ok).toBe(true);
  });

  it('retries on 500 errors with exponential backoff', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 500, statusText: 'Internal Server Error' }))
      .mockResolvedValueOnce(new Response('', { status: 500, statusText: 'Internal Server Error' }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const result = await fetchWithRetry('https://example.com', logger);
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('returns error after exhausting retries', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 500, statusText: 'Error' }));

    const result = await fetchWithRetry('https://example.com', logger);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('500');
    }
  });

  it('retries on network errors', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'));

    const result = await fetchWithRetry('https://example.com', logger);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('3 attempts');
    }
  });
});

// --- HashStore ---

describe('HashStore', () => {
  let store: HashStore;
  let tmpDir: string;

  beforeEach(async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    tmpDir = await mkdtemp(join(tmpdir(), 'hashstore-test-'));
    store = new HashStore(tmpDir);
  });

  it('returns undefined for unknown keys', async () => {
    expect(await store.getHash('nonexistent')).toBeUndefined();
  });

  it('stores and retrieves hashes', async () => {
    await store.setHash('key1', 'abc123');
    expect(await store.getHash('key1')).toBe('abc123');
  });

  it('detects when hash has changed', async () => {
    await store.setHash('key1', 'hash-v1');
    expect(await store.hasChanged('key1', 'hash-v1')).toBe(false);
    expect(await store.hasChanged('key1', 'hash-v2')).toBe(true);
  });

  it('reports changed for new keys', async () => {
    expect(await store.hasChanged('new-key', 'any-hash')).toBe(true);
  });

  it('persists across instances', async () => {
    await store.setHash('persist', 'value');
    const store2 = new HashStore(tmpDir);
    expect(await store2.getHash('persist')).toBe('value');
  });
});

// --- OlrcFetcher ---

describe('OlrcFetcher', () => {
  const logger = createLogger('test', 'error');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listReleasePoints fetches and parses the download page', async () => {
    const html = `
      <h2>Public Law 118-200 (11/15/2024)</h2>
      <a href="/download/releasepoints/us/pl/118/200/xml_usc42@118-200.zip">T42</a>
    `;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(html, { status: 200 }));

    const fetcher = new OlrcFetcher({ logger });
    const result = await fetcher.listReleasePoints();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.title).toBe('42');
      expect(result.value[0]?.publicLaw).toBe('PL 118-200');
    }
  });

  it('listReleasePoints filters by title', async () => {
    const html = `
      <h2>Public Law 118-200 (11/15/2024)</h2>
      <a href="/download/releasepoints/us/pl/118/200/xml_usc42@118-200.zip">T42</a>
      <a href="/download/releasepoints/us/pl/118/200/xml_usc26@118-200.zip">T26</a>
    `;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(html, { status: 200 }));

    const fetcher = new OlrcFetcher({ logger });
    const result = await fetcher.listReleasePoints('26');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.title).toBe('26');
    }
  });

  it('listHistoricalReleasePoints fetches and merges prior + current', async () => {
    const priorHtml = `
      <a class="releasepoint" href="/download/releasepoints/us/pl/113/21/usc-rp@113-21.htm">
        Public Law 113-21 (07/18/2013)</a>
      <a class="releasepoint" href="/download/releasepoints/us/pl/118/200/usc-rp@118-200.htm">
        Public Law 118-200 (11/15/2024)</a>
    `;
    const currentHtml = `<h2>Public Law 119-73 (01/23/2026)</h2>`;

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(priorHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(currentHtml, { status: 200 }));

    const fetcher = new OlrcFetcher({ logger });
    const result = await fetcher.listHistoricalReleasePoints();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
      // Oldest first
      expect(result.value[0]?.publicLaw).toBe('PL 113-21');
      expect(result.value[2]?.publicLaw).toBe('PL 119-73');
    }
  });

  it('listHistoricalReleasePoints deduplicates current if already in prior list', async () => {
    const priorHtml = `
      <a class="releasepoint" href="/download/releasepoints/us/pl/119/73not60/usc-rp@119-73not60.htm">
        Public Law 119-73 (01/23/2026)</a>
    `;
    const currentHtml = `<h2>Public Law 119-73 (01/23/2026)</h2>`;

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(priorHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(currentHtml, { status: 200 }));

    const fetcher = new OlrcFetcher({ logger });
    const result = await fetcher.listHistoricalReleasePoints();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
    }
  });

  it('fetchXml returns error for non-ZIP content', async () => {
    const nonZip = Buffer.from('this is not a zip file at all');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(nonZip, { status: 200 })
    );

    const rp: ReleasePoint = { title: '42', publicLaw: 'PL 118-200', dateET: '2024-01-01T00:00:00Z', uslmUrl: 'https://example.com/t42.zip', sha256Hash: '0'.repeat(64) };
    const fetcher = new OlrcFetcher({ logger });
    const result = await fetcher.fetchXml(rp);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('not a valid ZIP');
    }
  });

  it('fetchXml skips download when hash is unchanged', async () => {
    // Create a fake ZIP (starts with PK signature)
    const zipContent = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('fake-zip-data')]);
    const hash = sha256(zipContent);

    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tmpDir = await mkdtemp(join(tmpdir(), 'fetcher-test-'));
    const hashStore = new HashStore(tmpDir);

    const rp: ReleasePoint = { title: '42', publicLaw: 'PL 118-200', dateET: '2024-01-01T00:00:00Z', uslmUrl: 'https://example.com/t42.zip', sha256Hash: '0'.repeat(64) };
    const hashKey = `xml:${rp.title}:${rp.uslmUrl}`;
    await hashStore.setHash(hashKey, hash);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(zipContent, { status: 200 })
    );

    const fetcher = new OlrcFetcher({ logger, hashStore });
    const result = await fetcher.fetchXml(rp);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Empty string means cached/unchanged
      expect(result.value).toBe('');
    }
  });

  it('fetchXml returns base64 content for valid ZIP', async () => {
    const zipContent = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('zip-payload')]);

    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tmpDir = await mkdtemp(join(tmpdir(), 'fetcher-test-'));
    const hashStore = new HashStore(tmpDir);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(zipContent, { status: 200 })
    );

    const rp: ReleasePoint = { title: '42', publicLaw: 'PL 118-200', dateET: '2024-01-01T00:00:00Z', uslmUrl: 'https://example.com/t42.zip', sha256Hash: '0'.repeat(64) };
    const fetcher = new OlrcFetcher({ logger, hashStore });
    const result = await fetcher.fetchXml(rp);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
      // Verify it's valid base64 that decodes to our content
      const decoded = Buffer.from(result.value, 'base64');
      expect(decoded[0]).toBe(0x50); // P
      expect(decoded[1]).toBe(0x4b); // K
    }
  });
});

// --- Logger ---

describe('createLogger', () => {
  it('startTimer returns elapsed time function', async () => {
    const output: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    };

    try {
      const log = createLogger('test', 'info');
      const done = log.startTimer('operation');
      // Small delay to ensure measurable time
      await new Promise((resolve) => setTimeout(resolve, 5));
      done();

      expect(output.length).toBeGreaterThanOrEqual(1);
      const lastOutput = output[output.length - 1];
      expect(lastOutput).toBeDefined();
      const entry = JSON.parse(lastOutput!) as Record<string, unknown>;
      expect(entry['message']).toBe('operation completed');
      expect(typeof entry['elapsedMs']).toBe('number');
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it('respects minimum log level', () => {
    const output: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    };

    try {
      const log = createLogger('test', 'warn');
      log.debug('should not appear');
      log.info('should not appear');
      log.warn('should appear');
      expect(output).toHaveLength(1);
      expect(output[0] ?? '').toContain('should appear');
    } finally {
      process.stdout.write = origWrite;
    }
  });
});

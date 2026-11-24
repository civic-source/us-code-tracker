import { createHash } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EcfrBulkSourceClient, type EcfrBulkSourceMetadata } from '../lib/ecfr-bulk-source.js';

const rootUrl = 'https://www.govinfo.gov/bulkdata/json/ECFR';
const sourceUrl = 'https://www.govinfo.gov/bulkdata/ECFR/title-19/ECFR-title19.xml';
const xml = '<?xml version="1.0"?><DLPSTEXTCLASS><HEADER/></DLPSTEXTCLASS>';
const modified = 'Mon, 23 Nov 2026 22:33:27 GMT';
const metadata: EcfrBulkSourceMetadata = { title: 19, url: sourceUrl, byteLength: Buffer.byteLength(xml), lastModified: new Date(modified).toISOString() };
const folder = (title: number) => ({ cfrTitle: title, folder: true, name: `title-${title}`, link: `${rootUrl}/title-${title}` });
const file = () => ({ folder: false, name: 'ECFR-title19.xml', justFileName: 'ECFR-title19.xml', fileExtension: 'xml', mimeType: 'application/xml', link: sourceUrl, size: metadata.byteLength, formattedLastModifiedTime: '23-Nov-2026 22:33' });

describe('GPO bulk source public HTTP seam', () => {
  let server: Server;
  let directory: string;
  let origin: string;
  let handle: (path: string, response: ServerResponse, headers: Record<string, string | string[] | undefined>) => void;
  let requests: { url: string; accept: string | undefined; started: number }[];
  let transport: typeof fetch;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ecfr-source-'));
    requests = [];
    handle = (path, response) => {
      if (path.endsWith('/json/ECFR')) {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ files: [folder(28), folder(19)] }));
      } else if (path.includes('/json/')) {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ files: [file()] }));
      } else {
        response.setHeader('Content-Type', 'text/xml');
        response.setHeader('Last-Modified', modified);
        response.end(xml);
      }
    };
    server = createServer((request, response) => handle(request.url ?? '/', response, request.headers));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    origin = `http://127.0.0.1:${address.port}`;
    transport = async (input, init) => {
      const url = String(input);
      requests.push({ url, accept: new Headers(init?.headers).get('Accept') ?? undefined, started: Date.now() });
      const response = await fetch(`${origin}${new URL(url).pathname}`, init);
      return new Response(response.body, { status: response.status, headers: response.headers });
    };
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it('retains global inventory while fetching only selected canonical title listings', async () => {
    const client = new EcfrBulkSourceClient({ fetch: transport, requestIntervalMs: 0 });
    const result = await client.inventory([19]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.titles).toEqual([19, 28]);
    expect(result.value.sources).toEqual([{ ...metadata, lastModified: '2026-11-23T22:33:00.000Z' }]);
    expect(requests.map((request) => request.url)).toEqual([rootUrl, `${rootUrl}/title-19`]);
    expect(requests.every((request) => request.accept === 'application/json')).toBe(true);
  });

  it('spaces requests and rejects a selected title absent from the publisher inventory', async () => {
    const client = new EcfrBulkSourceClient({ fetch: transport, requestIntervalMs: 25 });
    expect((await client.inventory([19])).ok).toBe(true);
    expect((requests[1]?.started ?? 0) - (requests[0]?.started ?? 0)).toBeGreaterThanOrEqual(25);
    expect((await client.inventory([20])).ok).toBe(false);
  });

  it.each(['foreign-url', 'duplicate-title', 'fractional-size', 'wrong-name', 'duplicate-xml', 'html', 'oversize-listing'])('rejects invalid inventory: %s', async (kind) => {
    handle = (path, response) => {
      response.setHeader('Content-Type', kind === 'html' ? 'text/html' : 'application/json');
      if (kind === 'oversize-listing') return void response.end(' '.repeat(65537));
      if (path.endsWith('/json/ECFR')) {
        const entries = kind === 'duplicate-title' ? [folder(19), folder(19)] : [folder(19)];
        response.end(JSON.stringify({ files: entries }));
      } else {
        const entry = file();
        if (kind === 'foreign-url') entry.link = 'https://example.com/ECFR-title19.xml';
        if (kind === 'fractional-size') entry.size = 1.5;
        if (kind === 'wrong-name') entry.name = 'ECFR-title28.xml';
        response.end(JSON.stringify({ files: kind === 'duplicate-xml' ? [entry, entry] : [entry] }));
      }
    };
    expect((await new EcfrBulkSourceClient({ fetch: transport, requestIntervalMs: 0 }).inventory([19])).ok).toBe(false);
  });

  it('streams original bytes to an exclusive destination and hashes actual bytes', async () => {
    const destination = join(directory, 'source.xml');
    const result = await new EcfrBulkSourceClient({ fetch: transport, requestIntervalMs: 0 }).download(metadata, destination);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ notModified: false, lastModified: metadata.lastModified, blob: { sha256: createHash('sha256').update(xml).digest('hex'), byteLength: metadata.byteLength } });
    expect(await readFile(destination, 'utf8')).toBe(xml);
    expect(new Date(result.value.retrievedAt).toISOString()).toBe(result.value.retrievedAt);
    await writeFile(destination, 'prior source');
    expect((await new EcfrBulkSourceClient({ fetch: transport }).download(metadata, destination)).ok).toBe(false);
    expect(await readFile(destination, 'utf8')).toBe('prior source');
  });

  it('sends the retained modification validator and handles 304 without a file', async () => {
    handle = (_path, response, headers) => {
      expect(headers['if-modified-since']).toBe(modified);
      response.writeHead(304, { 'Last-Modified': modified });
      response.end();
    };
    const previous = { title: 19, url: sourceUrl, blob: { sha256: 'a'.repeat(64), byteLength: metadata.byteLength }, lastModified: metadata.lastModified, retrievedAt: '2026-11-23T23:00:00.000Z', amendmentDateText: null };
    const destination = join(directory, 'unchanged.xml');
    const result = await new EcfrBulkSourceClient({ fetch: transport }).download(metadata, destination, previous);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ notModified: true, lastModified: metadata.lastModified });
    await expect(readFile(destination)).rejects.toThrow();
  });

  it.each(['newer-minute', 'different-size'])('does not send a stale validator for %s metadata or accept its unsolicited 304', async (kind) => {
    let conditional: string | string[] | undefined;
    handle = (_path, response, headers) => {
      conditional = headers['if-modified-since'];
      response.writeHead(304, { 'Last-Modified': modified });
      response.end();
    };
    const previous = { title: 19, url: sourceUrl, blob: { sha256: 'a'.repeat(64), byteLength: metadata.byteLength }, lastModified: metadata.lastModified, retrievedAt: '2026-11-23T23:00:00.000Z', amendmentDateText: null };
    const changed = kind === 'newer-minute' ? { ...metadata, lastModified: '2026-11-23T22:34:00.000Z' } : { ...metadata, byteLength: metadata.byteLength + 1 };
    const destination = join(directory, 'changed.xml');
    const result = await new EcfrBulkSourceClient({ fetch: transport }).download(changed, destination, previous);
    expect(conditional).toBeUndefined();
    expect(result.ok).toBe(false);
    await expect(readFile(destination)).rejects.toThrow();
  });

  it.each(['oversized', 'truncated', 'html', 'redirect', 'unsolicited-304', 'wrong-length'])('fails closed and removes staged data for %s transport', async (kind) => {
    handle = (_path, response) => {
      response.setHeader('Content-Type', kind === 'html' ? 'text/html' : 'text/xml');
      if (kind === 'redirect') { response.writeHead(302, { Location: 'https://example.com/source.xml' }); response.end(); return; }
      if (kind === 'unsolicited-304') { response.writeHead(304); response.end(); return; }
      if (kind === 'truncated') { response.setHeader('Content-Length', metadata.byteLength); response.write(xml.slice(0, 10)); setImmediate(() => response.destroy()); return; }
      if (kind === 'oversized') { response.write(xml); response.end('x'.repeat(100)); return; }
      response.end(kind === 'html' ? '<html>Blocked</html>' : xml.slice(0, -1));
    };
    const destination = join(directory, 'failed.xml');
    expect((await new EcfrBulkSourceClient({ fetch: transport, maxSourceBytes: metadata.byteLength }).download(metadata, destination)).ok).toBe(false);
    await expect(readFile(destination)).rejects.toThrow();
  });

  it('refuses excessive advertised size and foreign metadata before contacting a server', async () => {
    const client = new EcfrBulkSourceClient({ fetch: transport, maxSourceBytes: 10 });
    expect((await client.download(metadata, join(directory, 'large'))).ok).toBe(false);
    expect((await client.download({ ...metadata, byteLength: 5, url: 'https://example.com/file' }, join(directory, 'foreign'))).ok).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

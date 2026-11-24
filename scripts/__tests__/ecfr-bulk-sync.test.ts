import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type EcfrBulkIndex, type EcfrBulkSnapshot, type Result } from '@civic-source/types';
import { EcfrBulkStore, canonicalJson, snapshotIdFor } from '../lib/ecfr-bulk-store.js';
import { EcfrBulkSourceClient } from '../lib/ecfr-bulk-source.js';
import { rebuildEcfrSnapshot, syncEcfrSnapshot } from '../lib/ecfr-bulk-sync.js';

const dirs: string[] = [];
const rootUrl = 'https://www.govinfo.gov/bulkdata/json/ECFR';
const sourceUrl = 'https://www.govinfo.gov/bulkdata/ECFR/title-28/ECFR-title28.xml';
const xml = (citation = '1') => `<?xml version="1.0"?><DLPSTEXTCLASS><HEADER><FILEDESC><IDNO TYPE="title">28</IDNO></FILEDESC></HEADER><TEXT><BODY><ECFRBRWS><AMDDATE>Jan. 1, 2026</AMDDATE><DIV1 N="1" TYPE="TITLE"><DIV5 N="0" TYPE="PART"><HEAD>PART 0—Organization</HEAD><AUTH>18 U.S.C. ${citation}.</AUTH></DIV5></DIV1></ECFRBRWS></BODY></TEXT></DLPSTEXTCLASS>`;
function value<T>(result: Result<T>): T { if (!result.ok) throw result.error; return result.value; }
async function store(): Promise<EcfrBulkStore> {
  const dir = await mkdtemp(join(tmpdir(), 'ecfr-sync-'));
  dirs.push(dir);
  const cache = new EcfrBulkStore(dir, { minFreeBytes: 0 });
  value(await cache.init());
  return cache;
}
function publisher() {
  const state = { body: xml(), modified: 'Thu, 01 Jan 2026 00:00:00 GMT', listing: '01-Jan-2026 00:00' };
  const requests: { url: string; conditional: string | null }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    const conditional = new Headers(init?.headers).get('If-Modified-Since');
    requests.push({ url, conditional });
    if (url === rootUrl) return Response.json({ files: [19, 28].map((title) => ({ cfrTitle: title, folder: true, name: `title-${title}`, link: `${rootUrl}/title-${title}` })) });
    if (url === `${rootUrl}/title-28`) return Response.json({ files: [{ folder: false, name: 'ECFR-title28.xml', justFileName: 'ECFR-title28.xml', fileExtension: 'xml', mimeType: 'application/xml', link: sourceUrl, size: Buffer.byteLength(state.body), formattedLastModifiedTime: state.listing }] });
    if (url !== sourceUrl) throw new Error(`Unexpected source request: ${url}`);
    if (conditional === state.modified) return new Response(null, { status: 304, headers: { 'Last-Modified': state.modified } });
    return new Response(state.body, { headers: { 'Content-Type': 'application/xml', 'Last-Modified': state.modified } });
  };
  return { state, requests, client: new EcfrBulkSourceClient({ fetch: transport, requestIntervalMs: 0 }) };
}
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('eCFR snapshot capture and offline replay', () => {
  it('rejects --since without a verified baseline before contacting the source', async () => {
    const source = publisher();
    const result = await syncEcfrSnapshot({ store: await store(), titles: [28], since: '2026-01-01', client: source.client });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/baseline/i);
    expect(source.requests).toEqual([]);
  });

  it('captures exact retained bytes and reproduces canonical output with networking blocked', async () => {
    const cache = await store();
    const source = publisher();
    const captured = value(await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client }));
    expect(captured.selectedTitles).toEqual([28]);
    expect(captured.inventoryTitles).toEqual([19, 28]);
    expect(captured.sources[0]?.amendmentDateText).toBe('Jan. 1, 2026');
    expect(await readFile(cache.blobPath(captured.sources[0]!.blob), 'utf8')).toBe(source.state.body);
    const before = value(await cache.readBlob(captured.index));
    const blockedFetch = vi.fn(async () => { throw new Error('Networking disabled for replay'); });
    vi.stubGlobal('fetch', blockedFetch);
    expect(value(await rebuildEcfrSnapshot(cache))).toEqual(captured);
    expect(value(await cache.readBlob(captured.index))).toEqual(before);
    expect(blockedFetch).not.toHaveBeenCalled();
  });

  it('retains original snapshot identity and observations after unchanged conditional 304', async () => {
    const cache = await store();
    const source = publisher();
    const first = value(await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client }));
    source.requests.length = 0;
    const refreshed = value(await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client }));
    expect(refreshed).toEqual(first);
    expect(source.requests.filter((request) => request.url === sourceUrl)).toEqual([{ url: sourceUrl, conditional: source.state.modified }]);
  });

  it('uses second-precision HTTP validators with the minute-precision publisher inventory', async () => {
    const cache = await store();
    const source = publisher();
    source.state.modified = 'Thu, 01 Jan 2026 00:00:27 GMT';
    const first = value(await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client }));
    source.requests.length = 0;
    expect(value(await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client }))).toEqual(first);
    expect(source.requests.filter((request) => request.url === sourceUrl)).toEqual([{ url: sourceUrl, conditional: source.state.modified }]);
  });

  it('conditionally validates an old unchanged source since a date without downloading its body', async () => {
    const cache = await store();
    const source = publisher();
    source.state.modified = 'Thu, 01 Jan 2026 00:00:27 GMT';
    const first = value(await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client }));
    source.requests.length = 0;
    expect(value(await syncEcfrSnapshot({ store: cache, titles: [28], since: '2027-01-01', client: source.client }))).toEqual(first);
    expect(source.requests.map((request) => request.url)).toEqual([rootUrl, `${rootUrl}/title-28`, sourceUrl]);
    expect(source.requests.at(-1)?.conditional).toBe(source.state.modified);
  });

  it('detects a same-size change within the minute despite an older-than-since inventory timestamp', async () => {
    const cache = await store();
    const source = publisher();
    source.state.modified = 'Thu, 01 Jan 2026 00:00:27 GMT';
    const first = value(await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client }));
    source.state.body = xml('2');
    source.state.modified = 'Thu, 01 Jan 2026 00:00:40 GMT';
    source.requests.length = 0;
    const refreshed = value(await syncEcfrSnapshot({ store: cache, titles: [28], since: '2027-01-01', client: source.client }));
    expect(refreshed.snapshotId).not.toBe(first.snapshotId);
    expect(refreshed.index.sha256).not.toBe(first.index.sha256);
    expect(source.requests.filter((request) => request.url === sourceUrl)).toEqual([{ url: sourceUrl, conditional: 'Thu, 01 Jan 2026 00:00:27 GMT' }]);
  });

  it('fetches known changes older than --since without a stale conditional validator', async () => {
    const cache = await store();
    const source = publisher();
    const first = value(await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client }));
    source.state.body = xml('2');
    source.state.modified = 'Fri, 02 Jan 2026 00:00:00 GMT';
    source.state.listing = '02-Jan-2026 00:00';
    source.requests.length = 0;
    const changed = value(await syncEcfrSnapshot({ store: cache, titles: [28], since: '2027-01-01', client: source.client }));
    expect(changed.snapshotId).not.toBe(first.snapshotId);
    expect(changed.index.sha256).not.toBe(first.index.sha256);
    expect(source.requests.filter((request) => request.url === sourceUrl)).toEqual([{ url: sourceUrl, conditional: null }]);
    expect(value(await rebuildEcfrSnapshot(cache))).toEqual(changed);
  });

  it('retains a new publisher validator when identical source bytes are republished', async () => {
    const cache = await store();
    const source = publisher();
    const first = value(await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client }));
    source.state.modified = 'Fri, 02 Jan 2026 00:00:00 GMT';
    source.state.listing = '02-Jan-2026 00:00';
    const republished = value(await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client }));
    expect(republished.sources[0]?.blob).toEqual(first.sources[0]?.blob);
    expect(republished.index).toEqual(first.index);
    expect(republished.sources[0]?.lastModified).toBe('2026-01-02T00:00:00.000Z');
    source.requests.length = 0;
    expect(value(await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client }))).toEqual(republished);
    expect(source.requests.filter((request) => request.url === sourceUrl)).toEqual([{ url: sourceUrl, conditional: source.state.modified }]);
  });

  it('rejects a corrupt baseline before networking and preserves its accepted pointer', async () => {
    const cache = await store();
    const source = publisher();
    const first = value(await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client }));
    const pointer = await readFile(join(cache.cacheDir, 'current.json'), 'utf8');
    await writeFile(cache.blobPath(first.sources[0]!.blob), 'corrupted');
    source.requests.length = 0;
    expect((await syncEcfrSnapshot({ store: cache, titles: [28], since: '2027-01-01', client: source.client })).ok).toBe(false);
    expect(source.requests).toEqual([]);
    expect(await readFile(join(cache.cacheDir, 'current.json'), 'utf8')).toBe(pointer);
    expect((await rebuildEcfrSnapshot(cache)).ok).toBe(false);
  });

  it('preserves the accepted baseline when newly downloaded XML fails parsing', async () => {
    const cache = await store();
    const source = publisher();
    const first = value(await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client }));
    source.state.body = xml().slice(0, -20);
    source.state.modified = 'Fri, 02 Jan 2026 00:00:00 GMT';
    source.state.listing = '02-Jan-2026 00:00';
    expect((await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client })).ok).toBe(false);
    expect(value(await cache.loadSnapshot())).toEqual(first);
    expect(value(await rebuildEcfrSnapshot(cache))).toEqual(first);
  });

  it('rejects offline replay with a different recorded extractor identity', async () => {
    const cache = await store();
    const source = publisher();
    const first = value(await syncEcfrSnapshot({ store: cache, titles: [28], client: source.client }));
    const index = JSON.parse(value(await cache.readBlob(first.index)).toString('utf8')) as EcfrBulkIndex;
    index.extractorDigest = 'a'.repeat(64);
    const recordedIndex = value(await cache.putBlob(canonicalJson(index) + '\n'));
    const payload: Omit<EcfrBulkSnapshot, 'snapshotId'> = { ...first, index: recordedIndex, extractorDigest: index.extractorDigest };
    const other = { ...payload, snapshotId: snapshotIdFor(payload) };
    value(await cache.acceptSnapshot(other));
    const result = await rebuildEcfrSnapshot(cache);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/producer revision\/extractor/);
    expect(value(await cache.loadSnapshot())).toEqual(other);
  });
});

it('replays archived cohort products and rejects a changed projection implementation contract',async()=>{
 const cache=await store();const source=publisher();
 const snapshot=value(await syncEcfrSnapshot({store:cache,titles:[28],client:source.client}));
 const {readEcfrIndex}=await import('../lib/ecfr-bulk-sync.js');
 const {projectEcfrCohort}=await import('../lib/ecfr-bulk-projection.js');
 const index=value(await readEcfrIndex(cache,snapshot));
 const projection=value(projectEcfrCohort(snapshot,index,'18',['1','2']));
 const good=value(await cache.putBlob(canonicalJson(projection)+'\n'));
 value(await cache.registerProduct(snapshot.snapshotId,good));
 expect((await rebuildEcfrSnapshot(cache)).ok).toBe(true);
 const changed=value(await cache.putBlob(canonicalJson({...projection,projectionVersion:'other-version'})+'\n'));
 value(await cache.registerProduct(snapshot.snapshotId,changed));
 const result=await rebuildEcfrSnapshot(cache);expect(result.ok).toBe(false);
 if(!result.ok)expect(result.error.message).toMatch(/projection|product/i);
});

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EcfrBulkSource, Result } from '@civic-source/types';
import { EcfrBulkStore } from '../lib/ecfr-bulk-store.js';
import { recordAcquisition, recoverAcquisition } from '../lib/ecfr-bulk-acquisition.js';

const directories: string[] = [];
const url = 'https://www.govinfo.gov/bulkdata/ECFR/title-28/ECFR-title28.xml';
function value<T>(result: Result<T>): T { if (!result.ok) throw result.error; return result.value; }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ecfr-acquisition-'));
  directories.push(directory);
  let freeBytes = 1024 ** 3;
  const store = new EcfrBulkStore(directory, { minFreeBytes: 0, capacityProvider: async () => freeBytes });
  value(await store.init());
  const blob = value(await store.putBlob('<DLPSTEXTCLASS/>'));
  const source: EcfrBulkSource = { title: 28, url, blob, lastModified: '2026-11-24T00:00:27.000Z', retrievedAt: '2026-11-24T00:01:00.000Z', amendmentDateText: null };
  const metadata = { title: 28, url, byteLength: blob.byteLength, lastModified: '2026-11-24T00:00:00.000Z' };
  return { store, source, metadata, directory, setFree: (bytes: number) => { freeBytes = bytes; } };
}
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe('unaccepted eCFR acquisition receipts', () => {
  it('returns no acquisition for a missing receipt and creates no accepted snapshot', async () => {
    const { store, metadata, directory } = await fixture();
    expect(value(await recoverAcquisition(store, metadata))).toBeUndefined();
    await expect(readFile(join(directory, 'current.json'))).rejects.toThrow();
  });

  it('durably records a verified acquisition and recovers it without an accepted generation', async () => {
    const { store, source, metadata, directory } = await fixture();
    value(await recordAcquisition(store, source));
    expect(value(await recoverAcquisition(store, metadata))).toEqual(source);
    expect(JSON.parse(await readFile(join(directory, 'acquisitions', 'title-28.json'), 'utf8'))).toEqual(source);
    expect(await readdir(store.stagingDir)).toEqual([]);
    await expect(readFile(join(directory, 'current.json'))).rejects.toThrow();
  });

  it('returns the retained observation when current metadata changes, leaving freshness to HTTP validation', async () => {
    const { store, source, metadata } = await fixture();
    value(await recordAcquisition(store, source));
    expect(value(await recoverAcquisition(store, { ...metadata, byteLength: metadata.byteLength + 1, lastModified: '2026-11-25T00:00:00.000Z' }))).toEqual(source);
  });

  it.each(['invalid-json', 'wrong-title', 'foreign-url', 'missing-blob', 'corrupt-blob', 'oversize-receipt'])('fails closed for %s', async (kind) => {
    const { store, source, metadata, directory } = await fixture();
    value(await recordAcquisition(store, source));
    const receipt = join(directory, 'acquisitions', 'title-28.json');
    if (kind === 'invalid-json') await writeFile(receipt, '{');
    if (kind === 'wrong-title') await writeFile(receipt, JSON.stringify({ ...source, title: 19 }));
    if (kind === 'foreign-url') await writeFile(receipt, JSON.stringify({ ...source, url: 'https://example.com/source.xml' }));
    if (kind === 'missing-blob') await rm(store.blobPath(source.blob));
    if (kind === 'corrupt-blob') await writeFile(store.blobPath(source.blob), 'corrupt');
    if (kind === 'oversize-receipt') await writeFile(receipt, ' '.repeat(65_537));
    expect((await recoverAcquisition(store, metadata)).ok).toBe(false);
  });

  it('refuses malformed acquisition identities and unverifiable blobs before writing receipts', async () => {
    const { store, source, metadata, directory } = await fixture();
    expect((await recordAcquisition(store, { ...source, url: 'https://example.com/source.xml' })).ok).toBe(false);
    expect((await recoverAcquisition(store, { ...metadata, title: 19 })).ok).toBe(false);
    expect((await recordAcquisition(store, { ...source, blob: { ...source.blob, sha256: 'b'.repeat(64) } })).ok).toBe(false);
    await expect(readFile(join(directory, 'acquisitions', 'title-28.json'))).rejects.toThrow();
  });

  it('preserves the prior receipt when disk capacity refuses its replacement', async () => {
    const { store, source, metadata, setFree } = await fixture();
    value(await recordAcquisition(store, source));
    setFree(0);
    expect((await recordAcquisition(store, { ...source, retrievedAt: '2026-11-25T00:01:00.000Z' })).ok).toBe(false);
    expect(value(await recoverAcquisition(store, metadata))).toEqual(source);
    expect(await readdir(store.stagingDir)).toEqual([]);
  });

  it('cleans staging files when the destination is obstructed', async () => {
    const { store, source, directory } = await fixture();
    await mkdir(join(directory, 'acquisitions', 'title-28.json'), { recursive: true });
    expect((await recordAcquisition(store, source)).ok).toBe(false);
    expect(await readdir(store.stagingDir)).toEqual([]);
  });
});

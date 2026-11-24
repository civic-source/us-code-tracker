import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ok, type EcfrBulkSnapshot } from '@civic-source/types';
import { canonicalJson, digestBytes, EcfrBulkStore, snapshotIdFor } from '../lib/ecfr-bulk-store.js';

const roots: string[] = [];
async function makeStore(options: ConstructorParameters<typeof EcfrBulkStore>[1] = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ecfr-store-'));
  roots.push(root);
  const store = new EcfrBulkStore(root, { minFreeBytes: 0, ...options });
  expect((await store.init()).ok).toBe(true);
  return store;
}
async function snapshot(store: EcfrBulkStore): Promise<EcfrBulkSnapshot> {
  const source = await store.putBlob('<xml/>');
  if (!source.ok) throw source.error;
  const extractorDigest = digestBytes('extractor');
  const index = await store.putBlob(canonicalJson({
    schemaVersion: 'usct.ecfr-bulk-index/v1', extractorVersion: 'v1', extractorDigest,
    titles: [{ schemaVersion: 'usct.ecfr-bulk-title/v1', cfrTitle: 19,
      sourceSha256: source.value.sha256, amendmentDateText: null, authorities: [] }],
  }));
  if (!index.ok) throw index.error;
  const payload: Omit<EcfrBulkSnapshot, 'snapshotId'> = {
    schemaVersion: 'usct.ecfr-bulk-snapshot/v1', capturedAt: '2026-11-24T00:00:00.000Z',
    inventoryTitles: [19, 28], selectedTitles: [19], extractorVersion: 'v1', extractorDigest,
    sources: [{ title: 19, url: 'https://www.govinfo.gov/bulkdata/ECFR/title-19/ECFR-title19.xml',
      blob: source.value, retrievedAt: '2026-11-24T00:00:00.000Z', lastModified: null, amendmentDateText: null }],
    index: index.value,
  };
  return { ...payload, snapshotId: snapshotIdFor(payload) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('eCFR bulk immutable store', () => {
  it('canonicalizes keys and retains array ordering', () => {
    expect(canonicalJson({ b: 2, a: [{ d: 4, c: 3 }] })).toBe('{"a":[{"c":3,"d":4}],"b":2}');
  });
  it('reuses verified blobs and rejects existing corruption', async () => {
    const store = await makeStore();
    const first = await store.putBlob('original');
    if (!first.ok) throw first.error;
    expect(await store.putBlob('original')).toEqual(first);
    await writeFile(store.blobPath(first.value), 'corrupt!');
    expect((await store.putBlob('original')).ok).toBe(false);
    expect((await store.verifyBlob(first.value)).ok).toBe(false);
  });
  it('adopts staged files only when hash and byte length match', async () => {
    const store = await makeStore();
    const path = join(store.stagingDir, 'download');
    await writeFile(path, 'source');
    const ref = { sha256: digestBytes('source'), byteLength: 6 };
    expect((await store.adoptBlob(path, { ...ref, byteLength: 7 })).ok).toBe(false);
    expect((await store.adoptBlob(path, ref)).ok).toBe(true);
    const read = await store.readBlob(ref);
    expect(read.ok && read.value.toString()).toBe('source');
    expect((await store.readBlob(ref, 5)).ok).toBe(false);
  });
  it.each([true, false])('rejects a symlinked staging ancestor without unlinking outside files (target exists: %s)', async (targetExists) => {
    const store = await makeStore();
    const outside = await mkdtemp(join(tmpdir(), 'ecfr-outside-'));
    roots.push(outside);
    const externalFile = join(outside, 'input.xml');
    await writeFile(externalFile, 'outside');
    const ref = { sha256: digestBytes('outside'), byteLength: 7 };
    if (targetExists) expect((await store.putBlob('outside')).ok).toBe(true);
    await symlink(outside, join(store.stagingDir, 'nested'), 'dir');
    expect((await store.adoptBlob(join(store.stagingDir, 'nested', 'input.xml'), ref)).ok).toBe(false);
    expect(await readFile(externalFile, 'utf8')).toBe('outside');
  });
  it('adopts files inside real nested staging directories', async () => {
    const store = await makeStore();
    const nested = join(store.stagingDir, 'import');
    await mkdir(nested);
    await writeFile(join(nested, 'source.xml'), 'source');
    const ref = { sha256: digestBytes('source'), byteLength: 6 };
    expect((await store.adoptBlob(join(nested, 'source.xml'), ref)).ok).toBe(true);
    expect((await store.verifyBlob(ref)).ok).toBe(true);
  });
  it('keeps the accepted pointer when replacement inputs or index identity fail', async () => {
    const store = await makeStore();
    const accepted = await snapshot(store);
    expect((await store.acceptSnapshot(accepted)).ok).toBe(true);
    const changed = { ...accepted, extractorVersion: 'wrong' };
    changed.snapshotId = snapshotIdFor(changed);
    expect((await store.acceptSnapshot(changed)).ok).toBe(false);
    await rm(store.blobPath(accepted.sources[0]!.blob));
    expect((await store.acceptSnapshot(accepted)).ok).toBe(false);
    expect(JSON.parse(await readFile(join(store.cacheDir, 'current.json'), 'utf8')).snapshotId).toBe(accepted.snapshotId);
    expect((await store.loadSnapshot()).ok).toBe(false);
  });
  it('refuses insufficient disk reserve and cache quota before writing blobs', async () => {
    const store = await makeStore({ minFreeBytes: 5, capacityProvider: async () => 8 });
    expect((await store.putBlob('four')).ok).toBe(false);
    const quota = await makeStore({ maxCacheBytes: 2 });
    expect((await quota.putBlob('four')).ok).toBe(false);
    expect(await readdir(join(store.cacheDir, 'objects'))).toEqual([]);
    expect(await readdir(store.stagingDir)).toEqual([]);
    expect(await readdir(join(quota.cacheDir, 'objects'))).toEqual([]);
  });
  it('excludes concurrent writers and releases the lock after failure', async () => {
    const store = await makeStore();
    const second = new EcfrBulkStore(store.cacheDir, { minFreeBytes: 0 });
    const result = await store.withLock(async () => {
      expect((await second.withLock(async () => ok('overlap'))).ok).toBe(false);
      expect((await store.putBlob('inside-lock')).ok).toBe(true);
      return ok('done');
    });
    expect(result).toEqual(ok('done'));
    expect((await second.withLock(async () => { throw new Error('failed'); })).ok).toBe(false);
    expect((await store.withLock(async () => ok('released'))).ok).toBe(true);
  });
  it('reopens immutable accepted snapshots and reuses an already adopted artifact', async () => {
    const store = await makeStore();
    const accepted = await snapshot(store);
    expect((await store.acceptSnapshot(accepted)).ok).toBe(true);
    expect((await store.acceptSnapshot(accepted)).ok).toBe(true);
    const reopened = new EcfrBulkStore(store.cacheDir, { minFreeBytes: 0 });
    expect(await reopened.loadSnapshot()).toEqual(ok(accepted));
    const stage = join(store.stagingDir, 'duplicate');
    await writeFile(stage, '<xml/>');
    expect((await store.adoptBlob(stage, accepted.sources[0]!.blob)).ok).toBe(true);
    expect(await readdir(store.stagingDir)).toEqual([]);
    await writeFile(join(store.cacheDir, 'manifests', accepted.snapshotId + '.json'), '{}');
    expect((await store.acceptSnapshot(accepted)).ok).toBe(false);
  });
  it('registers only verified products and fails closed on later corruption', async () => {
    const store = await makeStore();
    const accepted = await snapshot(store);
    expect((await store.acceptSnapshot(accepted)).ok).toBe(true);
    const product = await store.putBlob('projection');
    if (!product.ok) throw product.error;
    expect((await store.registerProduct(accepted.snapshotId, product.value)).ok).toBe(true);
    expect((await store.registerProduct(accepted.snapshotId, product.value)).ok).toBe(true);
    expect(await store.listProducts(accepted.snapshotId)).toEqual(ok([product.value]));
    await writeFile(store.blobPath(product.value), 'corrupted');
    expect((await store.listProducts(accepted.snapshotId)).ok).toBe(false);
  });
});

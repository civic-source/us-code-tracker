import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { type EcfrBulkSnapshot } from '@civic-source/types';
import { canonicalJson, digestBytes, EcfrBulkStore, snapshotIdFor } from '../lib/ecfr-bulk-store.js';
import { exportSnapshot, importSnapshot } from '../lib/ecfr-bulk-archive.js';
import { ok } from '@civic-source/types';
import { type GithubAssetDownloader } from '../lib/ecfr-bulk-archive-download.js';
import { archiveToGithub, restoreFromGithub, type GithubRunner } from '../lib/ecfr-bulk-archive-github.js';
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ecfr-archive-')); roots.push(root);
  const store = new EcfrBulkStore(join(root, 'source'), { minFreeBytes: 0 });
  expect((await store.init()).ok).toBe(true);
  const raw = await store.putBlob('<source/>'); if (!raw.ok) throw raw.error;
  const extractorDigest = digestBytes('extractor');
  const index = await store.putBlob(canonicalJson({ schemaVersion: 'usct.ecfr-bulk-index/v1', extractorVersion: 'v1', extractorDigest,
    titles: [{ schemaVersion: 'usct.ecfr-bulk-title/v1', cfrTitle: 19, sourceSha256: raw.value.sha256, amendmentDateText: null, authorities: [] }] }));
  if (!index.ok) throw index.error;
  const payload: Omit<EcfrBulkSnapshot, 'snapshotId'> = { schemaVersion: 'usct.ecfr-bulk-snapshot/v1',
    capturedAt: '2026-11-24T00:00:00.000Z', inventoryTitles: [19, 28], selectedTitles: [19],
    extractorVersion: 'v1', extractorDigest, index: index.value, producerRevision: '0'.repeat(40),
    sources: [{ title: 19, url: 'https://www.govinfo.gov/bulkdata/ECFR/title-19/ECFR-title19.xml', blob: raw.value,
      lastModified: null, retrievedAt: '2026-11-24T00:00:00.000Z', amendmentDateText: null }] };
  const snapshot = { ...payload, snapshotId: snapshotIdFor(payload) };
  expect((await store.acceptSnapshot(snapshot)).ok).toBe(true);
  const product = await store.putBlob('reviewed overlay'); if (!product.ok) throw product.error;
  expect((await store.registerProduct(snapshot.snapshotId, product.value)).ok).toBe(true);
  return { root, store, snapshot, product: product.value };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
it('exports deterministic self-contained bytes and restores after complete source loss', async () => {
  const { root, store, snapshot, product } = await fixture();
  const first = join(root, 'first.tar.gz'); const second = join(root, 'second.tar.gz');
  expect(await exportSnapshot(store, snapshot.snapshotId, first)).toEqual(await exportSnapshot(store, snapshot.snapshotId, second));
  expect(await readFile(first)).toEqual(await readFile(second));
  await rm(store.cacheDir, { recursive: true });
  const restored = new EcfrBulkStore(join(root, 'restored'), { minFreeBytes: 0 });
  expect((await restored.init()).ok).toBe(true);
  expect(await importSnapshot(restored, first)).toEqual({ ok: true, value: snapshot });
  expect(await restored.listProducts(snapshot.snapshotId)).toEqual({ ok: true, value: [product] });
});
it('rejects corrupted archives before changing the accepted snapshot and never overwrites exports', async () => {
  const { root, store, snapshot } = await fixture(); const path = join(root, 'data.tar.gz');
  expect((await exportSnapshot(store, snapshot.snapshotId, path)).ok).toBe(true);
  expect((await exportSnapshot(store, snapshot.snapshotId, path)).ok).toBe(false);
  const bytes = await readFile(path); await writeFile(path, bytes.subarray(0, Math.floor(bytes.length / 2)));
  expect((await importSnapshot(store, path)).ok).toBe(false);
  expect(await store.loadSnapshot()).toEqual({ ok: true, value: snapshot });
});

for (const mode of ['traversal', 'duplicate', 'link', 'unexpected', 'missing', 'hash']) {
  it(`rejects ${mode} tar members before acceptance`, async () => {
    const { root, store, snapshot } = await fixture();
    const source = join(root, 'valid.tar.gz'); const altered = join(root, 'altered.tar.gz');
    expect((await exportSnapshot(store, snapshot.snapshotId, source)).ok).toBe(true);
    execFileSync('python3', ['-c', `import tarfile,io,sys
source,output,mode=sys.argv[1:]
with tarfile.open(source,'r:gz') as original,tarfile.open(output,'w:gz') as target:
    members=original.getmembers()
    for index,entry in enumerate(members):
        if mode=='missing' and index==len(members)-1: continue
        raw=original.extractfile(entry).read()
        if mode=='hash' and index==1: raw=b'x'*len(raw)
        target.addfile(entry,io.BytesIO(raw))
    if mode in ('traversal','duplicate','link','unexpected'):
        name={'traversal':'../escape','duplicate':'archive.json','link':'link','unexpected':'extra'}[mode]
        extra=tarfile.TarInfo(name)
        if mode=='link': extra.type=tarfile.SYMTYPE; extra.linkname='../escape'
        target.addfile(extra,io.BytesIO(b''))
`, source, altered, mode]);
    expect((await importSnapshot(store, altered)).ok).toBe(false);
    expect(await store.loadSnapshot()).toEqual({ ok: true, value: snapshot });
  });
}

function fakeGithub(corrupt = false) {
  const assets = new Map<string, Buffer>(); const commands: readonly string[][] = [];
  const releases = new Set<string>(); const tagRefs = new Map<string, string>(); let draft = true;
  const runner: GithubRunner = async (args) => {
    (commands as string[][]).push([...args]);
    const success = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' });
    if (args[0] === 'api' && args[1]!.endsWith('/git/refs')) {
      const ref = args.find((arg) => arg.startsWith('ref='))!.slice('ref='.length);
      const sha = args.find((arg) => arg.startsWith('sha='))!.slice('sha='.length);
      if (tagRefs.has(ref)) return { exitCode: 1, stdout: '', stderr: 'Reference already exists' };
      tagRefs.set(ref, sha); return success();
    }
    if (args[0] === 'api' && args[1]!.includes('/git/ref/tags/')) {
      const ref = 'refs/tags/' + args[1]!.split('/').at(-1)!;
      const sha = tagRefs.get(ref);
      return sha ? success(JSON.stringify({ ref, object: { sha, type: 'commit' } })) : { exitCode: 1, stdout: '', stderr: 'HTTP 404 Not Found' };
    }
    if (args[0] === 'api') return releases.has(args[1]!.split('/').at(-1)!) ? success(JSON.stringify({ draft, immutable: false, assets: [...assets.keys()].map((name, index) => ({ id: index + 1, name, size: assets.get(name)!.length, url: `https://api.github.com/repos/civic-source/us-code-tracker/releases/assets/${index + 1}` })) }))
      : { exitCode: 1, stdout: '', stderr: 'release not found' };
    if (args[1] === 'create') {
      releases.add(args[2]!); draft = true;
      for (const path of args.slice(3, 5)) assets.set(basename(path), await readFile(path));
      return success();
    }
    if (args[1] === 'edit') { draft = false; return success(); }
    throw new Error('Unexpected GitHub command');
  };
  const downloader: GithubAssetDownloader = async (asset, path) => {
    (commands as string[][]).push(['asset', 'download', asset.name]);
    const bytes = assets.get(asset.name)!;
    await writeFile(path, corrupt && asset.name.endsWith('.gz') ? Buffer.concat([bytes, Buffer.from('changed')]) : bytes);
    return ok(undefined);
  };
  return { runner, downloader, assets, commands, tagRefs };
}
it('publishes only after binary readback and restores verified assets through the runner seam', async () => {
  const { root, store, snapshot } = await fixture(); const github = fakeGithub();
  const options = { store, repository: 'civic-source/us-code-tracker', snapshotId: snapshot.snapshotId, producerRevision: '0'.repeat(40), runner: github.runner, downloader: github.downloader };
  const receipt = await archiveToGithub(options); expect(receipt.ok).toBe(true);
  expect(github.commands.findIndex((args) => args[1] === 'download')).toBeLessThan(github.commands.findIndex((args) => args[1] === 'edit'));
  expect(github.commands.filter((args) => args[1] === 'create' || args[1] === 'edit').every((args) => args.includes('--latest=false'))).toBe(true);
  expect(await archiveToGithub(options)).toEqual(receipt);
  expect(github.commands.filter((args) => args[1] === 'create')).toHaveLength(1);
  const restored = new EcfrBulkStore(join(root, 'remote-restored'), { minFreeBytes: 0 }); await restored.init();
  expect(await restoreFromGithub({ store: restored, repository: options.repository, tag: receipt.ok ? receipt.value.tag : '', runner: github.runner, downloader: github.downloader }))
    .toEqual({ ok: true, value: snapshot });
});
it('leaves draft unpublished when actual downloaded bytes differ', async () => {
  const { store, snapshot } = await fixture(); const github = fakeGithub(true);
  expect((await archiveToGithub({ store, repository: 'civic-source/us-code-tracker', snapshotId: snapshot.snapshotId,
    producerRevision: '0'.repeat(40), runner: github.runner, downloader: github.downloader })).ok).toBe(false);
  expect(github.commands.some((args) => args[1] === 'edit')).toBe(false);
});
it('rejects a receipt inconsistent with its archived producer before accepting restored data', async () => {
  const { root, store, snapshot } = await fixture(); const github = fakeGithub();
  expect((await archiveToGithub({ store, repository: 'civic-source/us-code-tracker', snapshotId: snapshot.snapshotId,
    producerRevision: '0'.repeat(40), runner: github.runner, downloader: github.downloader })).ok).toBe(true);
  const receipt = JSON.parse(github.assets.get('archive-receipt.json')!.toString()) as Record<string, unknown>;
  receipt.producerRevision = 'a'.repeat(40); github.assets.set('archive-receipt.json', Buffer.from(JSON.stringify(receipt)));
  const target = new EcfrBulkStore(join(root, 'target'), { minFreeBytes: 0 }); await target.init();
  expect((await restoreFromGithub({ store: target, repository: 'civic-source/us-code-tracker', tag: receipt.tag as string, runner: github.runner, downloader: github.downloader })).ok).toBe(false);
  expect((await target.loadSnapshot()).ok).toBe(false);
});
it('gives later products a distinct write-once archive tag', async () => {
  const { store, snapshot } = await fixture(); const github = fakeGithub();
  const options = { store, repository: 'civic-source/us-code-tracker', snapshotId: snapshot.snapshotId,
    producerRevision: '0'.repeat(40), runner: github.runner, downloader: github.downloader };
  const first = await archiveToGithub(options); expect(first.ok).toBe(true);
  const product = await store.putBlob('later product'); if (!product.ok) throw product.error;
  expect((await store.registerProduct(snapshot.snapshotId, product.value)).ok).toBe(true);
  const second = await archiveToGithub(options); expect(second.ok).toBe(true);
  expect(first.ok && second.ok && first.value.tag !== second.value.tag).toBe(true);
  expect(github.commands.filter((args) => args[1] === 'create')).toHaveLength(2);
});
it.each(['oversized-receipt', 'foreign-asset-url'])('refuses %s metadata before downloading a restore asset', async (mode) => {
  const { root, store, snapshot } = await fixture(); const github = fakeGithub();
  const archived = await archiveToGithub({ store, repository: 'civic-source/us-code-tracker', snapshotId: snapshot.snapshotId,
    producerRevision: '0'.repeat(40), runner: github.runner, downloader: github.downloader });
  if (!archived.ok) throw archived.error;
  const originalDownloads = github.commands.filter((args) => args[1] === 'download').length;
  const runner: GithubRunner = async (args) => {
    const result = await github.runner(args);
    if (args[0] !== 'api' || !args[1]!.includes('/releases/tags/') || result.exitCode !== 0) return result;
    const metadata = JSON.parse(result.stdout) as { assets: Array<{ name: string; size: number; url: string }> };
    const receipt = metadata.assets.find((asset) => asset.name === 'archive-receipt.json')!;
    if (mode === 'oversized-receipt') receipt.size = 65_537;
    else receipt.url = 'https://example.invalid/untrusted';
    return { ...result, stdout: JSON.stringify(metadata) };
  };
  const target = new EcfrBulkStore(join(root, 'metadata-target'), { minFreeBytes: 0 }); await target.init();
  expect((await restoreFromGithub({ store: target, repository: 'civic-source/us-code-tracker', tag: archived.value.tag,
    runner, downloader: github.downloader })).ok).toBe(false);
  expect(github.commands.filter((args) => args[1] === 'download')).toHaveLength(originalDownloads);
  expect((await target.loadSnapshot()).ok).toBe(false);
});

it('refuses a moved Git tag before restoring or acknowledging an existing archive', async () => {
  const { root, store, snapshot } = await fixture(); const github = fakeGithub();
  const options = { store, repository: 'civic-source/us-code-tracker', snapshotId: snapshot.snapshotId,
    producerRevision: '0'.repeat(40), runner: github.runner, downloader: github.downloader };
  const archived = await archiveToGithub(options); if (!archived.ok) throw archived.error;
  github.tagRefs.set(`refs/tags/${archived.value.tag}`, 'a'.repeat(40));
  expect((await archiveToGithub(options)).ok).toBe(false);
  const target = new EcfrBulkStore(join(root, 'wrong-tag'), { minFreeBytes: 0 }); await target.init();
  expect((await restoreFromGithub({ ...options, store: target, tag: archived.value.tag })).ok).toBe(false);
  expect((await target.loadSnapshot()).ok).toBe(false);
});
it('peels annotated archive tags to the exact retained producer commit', async () => {
  const { root, store, snapshot } = await fixture(); const github = fakeGithub();
  const options = { store, repository: 'civic-source/us-code-tracker', snapshotId: snapshot.snapshotId,
    producerRevision: '0'.repeat(40), runner: github.runner, downloader: github.downloader };
  const archived = await archiveToGithub(options); if (!archived.ok) throw archived.error;
  const annotated = 'b'.repeat(40);
  const runner: GithubRunner = async (args) => {
    if (args[0] === 'api' && args[1]!.includes('/git/ref/tags/')) return { exitCode: 0, stderr: '', stdout: JSON.stringify({
      ref: `refs/tags/${archived.value.tag}`, object: { sha: annotated, type: 'tag' } }) };
    if (args[0] === 'api' && args[1]!.endsWith('/git/tags/' + annotated)) return { exitCode: 0, stderr: '', stdout: JSON.stringify({
      sha: annotated, object: { sha: '0'.repeat(40), type: 'commit' } }) };
    return github.runner(args);
  };
  const target = new EcfrBulkStore(join(root, 'annotated-tag'), { minFreeBytes: 0 }); await target.init();
  expect((await restoreFromGithub({ ...options, runner, store: target, tag: archived.value.tag })).ok).toBe(true);
});

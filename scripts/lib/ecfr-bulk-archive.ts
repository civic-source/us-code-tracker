import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EcfrBulkArchiveSchema, err, ok, type EcfrBulkArchive, type EcfrBulkBlob, type EcfrBulkSnapshot, type Result } from '@civic-source/types';
import { canonicalJson, EcfrBulkStore } from './ecfr-bulk-store.js';
import { storeError } from './ecfr-bulk-capacity.js';
import { checkArchiveOutputCapacity, publishArchiveFile } from './ecfr-bulk-archive-output.js';

const helper = fileURLToPath(new URL('../python/ecfr_bulk_archive.py', import.meta.url));

async function runHelper(args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('python3', [helper, ...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 2 * 1024 ** 2) { child.kill(); reject(new Error('Archive helper output exceeded limit')); }
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolvePromise(stdout) : reject(new Error(`Archive helper failed: ${stderr}`)));
  });
}

export async function hashArchive(path: string): Promise<EcfrBulkBlob> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Archive is not a regular file');
  const digest = createHash('sha256'); let byteLength = 0;
  for await (const chunk of createReadStream(path)) { const bytes = chunk as Buffer; digest.update(bytes); byteLength += bytes.length; }
  return { sha256: digest.digest('hex'), byteLength };
}

async function bundleFor(store: EcfrBulkStore, snapshotId: string): Promise<Result<EcfrBulkArchive>> {
  const snapshot = await store.loadSnapshot(snapshotId);
  if (!snapshot.ok) return snapshot;
  const products = await store.listProducts(snapshotId);
  if (!products.ok) return products;
  const refs = [...snapshot.value.sources.map((source) => source.blob), snapshot.value.index, ...products.value];
  const blobs = [...new Map(refs.map((ref) => [ref.sha256, ref])).values()].sort((a, b) => a.sha256.localeCompare(b.sha256));
  return ok({ schemaVersion: 'usct.ecfr-bulk-archive/v1', snapshot: snapshot.value, products: products.value, blobs });
}

export async function exportSnapshot(store: EcfrBulkStore, snapshotId: string, outputPath: string): Promise<Result<EcfrBulkBlob>> {
  const stage = join(store.stagingDir, 'export-' + randomUUID());
  try {
    const bundle = await bundleFor(store, snapshotId);
    if (!bundle.ok) return bundle;
    const required = bundle.value.blobs.reduce((sum, blob) => sum + blob.byteLength, 0) * 1.01 + 2 * 1024 ** 2;
    const capacity = await store.ensureCapacity(Math.ceil(required * 2));
    if (!capacity.ok) return capacity;
    const inspected = await store.inspectCapacity();
    if (!inspected.ok) return inspected;
    const outputOptions = { minFreeBytes: inspected.value.minFreeBytes };
    const outputCapacity = await checkArchiveOutputCapacity(outputPath, Math.ceil(required), outputOptions);
    if (!outputCapacity.ok) return outputCapacity;
    await mkdir(stage);
    const manifest = join(stage, 'archive.json'); const archive = join(stage, 'snapshot.tar.gz');
    await writeFile(manifest, canonicalJson(bundle.value) + '\n', { flag: 'wx' });
    await runHelper(['export', '--root', store.cacheDir, '--manifest', manifest, '--output', archive]);
    await runHelper(['inspect', '--archive', archive]);
    const ref = await hashArchive(archive);
    const published = await publishArchiveFile(archive, outputPath, ref, outputOptions);
    return published.ok ? ok(ref) : published;
  } catch (error: unknown) { return err(storeError(error)); }
  finally { await rm(stage, { recursive: true, force: true }); }
}

export async function inspectSnapshotArchive(archivePath: string): Promise<Result<EcfrBulkArchive>> {
  try { return ok(EcfrBulkArchiveSchema.parse(JSON.parse(await runHelper(['inspect', '--archive', archivePath])))); }
  catch (error: unknown) { return err(storeError(error)); }
}

export async function importSnapshot(store: EcfrBulkStore, archivePath: string): Promise<Result<EcfrBulkSnapshot>> {
  const stage = join(store.stagingDir, 'import-' + randomUUID());
  try {
    const before = await hashArchive(archivePath);
    const bundle = EcfrBulkArchiveSchema.parse(JSON.parse(await runHelper(['inspect', '--archive', archivePath])));
    const capacity = await store.ensureCapacity(bundle.blobs.reduce((sum, blob) => sum + blob.byteLength, 0) + 2 * 1024 ** 2);
    if (!capacity.ok) return capacity;
    await mkdir(stage);
    await runHelper(['inspect', '--archive', archivePath, '--destination', stage]);
    const after = await hashArchive(archivePath);
    if (before.sha256 !== after.sha256 || before.byteLength !== after.byteLength) throw new Error('Archive changed during import');
    for (const blob of bundle.blobs) {
      const adopted = await store.adoptBlob(join(stage, blob.sha256), blob);
      if (!adopted.ok) return adopted;
    }
    const accepted = await store.acceptSnapshot(bundle.snapshot, bundle.products);
    if (!accepted.ok) return accepted;
    return ok(bundle.snapshot);
  } catch (error: unknown) { return err(storeError(error)); }
  finally { await rm(stage, { recursive: true, force: true }); }
}

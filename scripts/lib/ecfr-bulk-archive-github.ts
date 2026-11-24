import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EcfrBulkBlobSchema, err, ok, type EcfrBulkSnapshot, type Result } from '@civic-source/types';
import { canonicalJson, EcfrBulkStore } from './ecfr-bulk-store.js';
import { exportSnapshot, hashArchive, importSnapshot, inspectSnapshotArchive } from './ecfr-bulk-archive.js';
import { storeError } from './ecfr-bulk-capacity.js';
import { downloadGithubAsset, type GithubAssetDownloader, type GithubDownloadAsset } from './ecfr-bulk-archive-download.js';

export interface GithubCommandResult { exitCode: number; stdout: string; stderr: string }
export type GithubRunner = (args: readonly string[]) => Promise<GithubCommandResult>;
export interface GithubArchiveReceipt {
  schemaVersion: 'usct.ecfr-github-archive/v1';
  snapshotId: string; repository: string; tag: string; assetName: string;
  sha256: string; byteLength: number; producerRevision: string; releaseUrl: string;
}
export interface GithubVerifiedArchiveReceipt extends GithubArchiveReceipt { serverImmutable: boolean }
interface GithubOptions { store: EcfrBulkStore; repository: string; runner?: GithubRunner; downloader?: GithubAssetDownloader }
interface GithubReleaseMetadata { draft: boolean; immutable: boolean; assets: GithubDownloadAsset[] }

export const runGithub: GithubRunner = async (args) => new Promise((resolve, reject) => {
  const child = spawn('gh', [...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
    if (stdout.length > 2 * 1024 ** 2) { child.kill(); reject(new Error('GitHub metadata response exceeds limit')); }
  });
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
  child.on('error', reject);
  child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
});

function repositoryName(value: string): string {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value)) throw new Error('Invalid GitHub repository');
  return value;
}
function dataTag(snapshotId: string, archiveSha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(snapshotId)) throw new Error('Invalid archive snapshot ID');
  if (!/^[a-f0-9]{64}$/.test(archiveSha256)) throw new Error('Invalid archive byte identity');
  return `ecfr-data-${snapshotId.slice(0, 16)}-${archiveSha256.slice(0, 16)}`;
}
async function command(runner: GithubRunner, args: string[]): Promise<string> {
  const result = await runner(args);
  if (result.exitCode !== 0) throw new Error(`GitHub archive command failed: ${result.stderr}`);
  return result.stdout;
}
function parseReceipt(raw: string, repository: string, tag: string): GithubArchiveReceipt {
  const value = JSON.parse(raw) as Record<string, unknown>;
  const ref = EcfrBulkBlobSchema.parse({ sha256: value.sha256, byteLength: value.byteLength });
  if (value.schemaVersion !== 'usct.ecfr-github-archive/v1' || typeof value.snapshotId !== 'string' ||
      dataTag(value.snapshotId, ref.sha256) !== tag || value.repository !== repository || value.tag !== tag ||
      value.assetName !== `ecfr-${value.snapshotId}-${ref.sha256}.tar.gz` || typeof value.producerRevision !== 'string' ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.producerRevision) || value.releaseUrl !== `https://github.com/${repository}/releases/tag/${tag}`) {
    throw new Error('GitHub archive receipt identity mismatch');
  }
  return { schemaVersion: 'usct.ecfr-github-archive/v1', snapshotId: value.snapshotId, repository, tag,
    assetName: value.assetName as string, ...ref, producerRevision: value.producerRevision, releaseUrl: value.releaseUrl as string };
}

function parseRelease(raw: string, repository: string): GithubReleaseMetadata {
  const release = JSON.parse(raw) as Record<string, unknown>;
  if (typeof release.draft !== 'boolean' || !Array.isArray(release.assets) || release.assets.length > 32 ||
      (release.immutable !== undefined && typeof release.immutable !== 'boolean')) throw new Error('Malformed release metadata');
  const assets = release.assets.map((item: unknown): GithubDownloadAsset => {
    const asset = item as Record<string, unknown>;
    if (!Number.isSafeInteger(asset.id) || (asset.id as number) <= 0 || typeof asset.name !== 'string' ||
        !/^[a-zA-Z0-9._-]+$/.test(asset.name) || !Number.isSafeInteger(asset.size) || (asset.size as number) < 0 ||
        (asset.size as number) > 2 * 1024 ** 3 || asset.url !== `https://api.github.com/repos/${repository}/releases/assets/${asset.id}`) {
      throw new Error('Invalid GitHub release asset metadata');
    }
    return { id: asset.id as number, name: asset.name, size: asset.size as number, url: asset.url as string };
  });
  if (new Set(assets.map((asset) => asset.name)).size !== assets.length) throw new Error('Duplicate GitHub asset name');
  return { draft: release.draft, immutable: release.immutable === true, assets };
}
async function releaseMetadata(options: GithubOptions, tag: string): Promise<GithubReleaseMetadata> {
  return parseRelease(await command(options.runner ?? runGithub, ['api', `repos/${options.repository}/releases/tags/${tag}`]), options.repository);
}
async function fetchAsset(options: GithubOptions, metadata: GithubReleaseMetadata, name: string, path: string, maxBytes: number): Promise<void> {
  const asset = metadata.assets.find((item) => item.name === name);
  if (!asset || asset.size > maxBytes) throw new Error('Missing or oversized GitHub asset');
  const capacity = await options.store.ensureCapacity(asset.size);
  if (!capacity.ok) throw capacity.error;
  const downloaded = await (options.downloader ?? downloadGithubAsset)(asset, path);
  if (!downloaded.ok) throw downloaded.error;
  const actual = await hashArchive(path);
  if (actual.byteLength !== asset.size) throw new Error('Downloaded asset length differs from release metadata');
}
async function verifyGithubTag(options: GithubOptions, tag: string, revision: string, createMissing = false): Promise<void> {
  const runner = options.runner ?? runGithub;
  const endpoint = `repos/${options.repository}/git/ref/tags/${tag}`;
  let response = await runner(['api', endpoint]);
  if (response.exitCode !== 0 && createMissing && /HTTP 404|Not Found/i.test(response.stderr)) {
    await command(runner, ['api', `repos/${options.repository}/git/refs`, '--method', 'POST', '-f', `ref=refs/tags/${tag}`, '-f', `sha=${revision}`]);
    response = await runner(['api', endpoint]);
  }
  if (response.exitCode !== 0) throw new Error(`Cannot verify archive Git tag: ${response.stderr}`);
  const ref = JSON.parse(response.stdout) as Record<string, unknown>;
  if (ref.ref !== `refs/tags/${tag}`) throw new Error('Archive Git reference identity mismatch');
  let object = ref.object as Record<string, unknown>;
  for (let depth = 0; depth <= 4; depth++) {
    if (!object || typeof object.sha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(object.sha)) throw new Error('Invalid Git object identity');
    if (object.type === 'commit') {
      if (object.sha !== revision) throw new Error('Archive Git tag does not retain the declared producer revision');
      return;
    }
    if (object.type !== 'tag' || depth === 4) throw new Error('Unsupported or excessively nested archive Git tag');
    const annotated = JSON.parse(await command(runner, ['api', `repos/${options.repository}/git/tags/${object.sha}`])) as Record<string, unknown>;
    if (annotated.sha !== object.sha) throw new Error('Annotated Git tag identity mismatch');
    object = annotated.object as Record<string, unknown>;
  }
  throw new Error('Unresolved archive Git tag');
}

async function downloadVerified(options: GithubOptions, tag: string, directory: string): Promise<GithubArchiveReceipt> {
  const metadata = await releaseMetadata(options, tag);
  const receiptPath = join(directory, 'archive-receipt.json');
  await fetchAsset(options, metadata, 'archive-receipt.json', receiptPath, 65_536);
  const receipt = parseReceipt(await readFile(receiptPath, 'utf8'), options.repository, tag);
  await verifyGithubTag(options, tag, receipt.producerRevision);
  const archivePath = join(directory, receipt.assetName);
  const asset = metadata.assets.find((item) => item.name === receipt.assetName);
  if (!asset || asset.size !== receipt.byteLength) throw new Error('Archive size differs from receipt');
  await fetchAsset(options, metadata, receipt.assetName, archivePath, Math.min(receipt.byteLength, 2 * 1024 ** 3));
  const actual = await hashArchive(archivePath);
  if (actual.sha256 !== receipt.sha256) throw new Error('Downloaded GitHub asset failed byte verification');
  const bundle = await inspectSnapshotArchive(archivePath);
  if (!bundle.ok) throw bundle.error;
  if (bundle.value.snapshot.snapshotId !== receipt.snapshotId || bundle.value.snapshot.producerRevision !== receipt.producerRevision) {
    throw new Error('Downloaded archive manifest differs from GitHub receipt');
  }
  return receipt;
}

export async function archiveToGithub(options: GithubOptions & { snapshotId: string; producerRevision: string }): Promise<Result<GithubVerifiedArchiveReceipt>> {
  const stage = join(options.store.stagingDir, 'github-' + randomUUID());
  try {
    repositoryName(options.repository);
    const runner = options.runner ?? runGithub;
    const snapshot = await options.store.loadSnapshot(options.snapshotId);
    if (!snapshot.ok) return snapshot;
    if (snapshot.value.producerRevision !== options.producerRevision || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(options.producerRevision)) {
      throw new Error('Snapshot must retain the exact producer code revision before archival');
    }
    await mkdir(stage);
    const path = join(stage, 'payload.tar.gz');
    const exported = await exportSnapshot(options.store, options.snapshotId, path);
    if (!exported.ok) return exported;
    const tag = dataTag(options.snapshotId, exported.value.sha256);
    const assetName = `ecfr-${options.snapshotId}-${exported.value.sha256}.tar.gz`;
    const assetPath = join(stage, assetName); await rename(path, assetPath);
    const receipt: GithubArchiveReceipt = { schemaVersion: 'usct.ecfr-github-archive/v1', snapshotId: options.snapshotId,
      repository: options.repository, tag, assetName, ...exported.value, producerRevision: options.producerRevision,
      releaseUrl: `https://github.com/${options.repository}/releases/tag/${tag}` };
    const receiptPath = join(stage, 'archive-receipt.json');
    await writeFile(receiptPath, canonicalJson(receipt) + '\n', { flag: 'wx' });
    const existing = await runner(['api', `repos/${options.repository}/releases/tags/${tag}`]);
    if (existing.exitCode === 0) return await verifyExisting(options, tag, stage, existing.stdout, receipt);
    if (!/release not found|HTTP 404|Not Found/i.test(existing.stderr)) throw new Error(`GitHub release lookup failed: ${existing.stderr}`);
    await verifyGithubTag(options, tag, options.producerRevision, true);
    await command(runner, ['release', 'create', tag, assetPath, receiptPath, '--repo', options.repository, '--target', options.producerRevision,
      '--title', `eCFR data ${options.snapshotId}`, '--notes', 'Immutable source archive; restore with the recorded producer revision.', '--draft', '--latest=false']);
    const verifyDir = join(stage, 'readback'); await mkdir(verifyDir);
    const verified = await downloadVerified(options, tag, verifyDir);
    if (canonicalJson(verified) !== canonicalJson(receipt)) throw new Error('GitHub archive receipt changed during upload');
    await command(runner, ['release', 'edit', tag, '--repo', options.repository, '--draft=false', '--latest=false']);
    return ok({ ...verified, serverImmutable: (await releaseMetadata(options, tag)).immutable });
  } catch (error: unknown) { return err(storeError(error)); }
  finally { await rm(stage, { recursive: true, force: true }); }
}

async function verifyExisting(options: GithubOptions, tag: string, stage: string, metadata: string, expected: GithubArchiveReceipt): Promise<Result<GithubVerifiedArchiveReceipt>> {
  const release = parseRelease(metadata, options.repository);
  const directory = join(stage, 'existing-readback'); await mkdir(directory);
  const receipt = await downloadVerified(options, tag, directory);
  if (canonicalJson(receipt) !== canonicalJson(expected)) throw new Error('Existing immutable archive differs from the local bundle');
  if (release.draft) await command(options.runner ?? runGithub, ['release', 'edit', tag, '--repo', options.repository, '--draft=false', '--latest=false']);
  return ok({ ...receipt, serverImmutable: (await releaseMetadata(options, tag)).immutable });
}

export async function restoreFromGithub(options: GithubOptions & { tag: string }): Promise<Result<EcfrBulkSnapshot>> {
  const stage = join(options.store.stagingDir, 'github-restore-' + randomUUID());
  try {
    repositoryName(options.repository);
    if (!/^ecfr-data-[a-f0-9]{16}-[a-f0-9]{16}$/.test(options.tag)) throw new Error('Invalid eCFR archive tag');
    await mkdir(stage);
    const receipt = await downloadVerified(options, options.tag, stage);
    const restored = await importSnapshot(options.store, join(stage, receipt.assetName));
    if (!restored.ok) return restored;
    if (restored.value.snapshotId !== receipt.snapshotId || restored.value.producerRevision !== receipt.producerRevision) {
      throw new Error('Restored manifest differs from GitHub archive receipt');
    }
    return restored;
  } catch (error: unknown) { return err(storeError(error)); }
  finally { await rm(stage, { recursive: true, force: true }); }
}

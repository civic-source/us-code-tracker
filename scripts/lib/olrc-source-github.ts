import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type Result } from '@civic-source/types';
import { runGithub, type GithubRunner } from './ecfr-bulk-archive-github.js';
import { lookupGithubRelease } from './ecfr-bulk-archive-release.js';
import { downloadGithubAsset, type GithubAssetDownloader, type GithubDownloadAsset } from './ecfr-bulk-archive-download.js';
import { exportSourceCache, importSourceCache, sourceExportManifest } from './olrc-source-export.js';
import type { SourceBlobPin } from './olrc-source-cache.js';

interface SourceTransport {
  repository: string; pins: readonly SourceBlobPin[]; runner?: GithubRunner; downloader?: GithubAssetDownloader;
}
export function sourceArchiveTag(pins: readonly SourceBlobPin[]): string {
  return 'olrc-title18-inputs-' + createHash('sha256').update(sourceExportManifest(pins)).digest('hex');
}
function repository(value: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error('Invalid source archive repository');
  return value;
}
async function command(options: SourceTransport, args: string[]): Promise<string> {
  const result = await (options.runner ?? runGithub)(args);
  if (result.exitCode !== 0) throw new Error('Source archive command failed: ' + result.stderr);
  return result.stdout;
}
function releaseAssets(raw: string, options: SourceTransport, allowDraft: boolean): { assets: GithubDownloadAsset[]; immutable: boolean } {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid source release metadata');
  const release = value as Record<string, unknown>;
  if (release.tag_name !== sourceArchiveTag(options.pins) || typeof release.draft !== 'boolean' ||
    (!allowDraft && release.draft) || !Array.isArray(release.assets)) throw new Error('Source release identity/state mismatch');
  const expected = new Map(options.pins.map(pin => [pin.sha256, pin.byteLength]));
  expected.set('manifest.json', Buffer.byteLength(sourceExportManifest(options.pins)));
  const assets = release.assets.map((input: unknown): GithubDownloadAsset => {
    if (!input || typeof input !== 'object') throw new Error('Invalid source release asset');
    const item = input as Record<string, unknown>;
    if (!Number.isSafeInteger(item.id) || Number(item.id) < 1 || typeof item.name !== 'string' ||
      item.size !== expected.get(item.name) || !expected.has(item.name) ||
      item.url !== `https://api.github.com/repos/${options.repository}/releases/assets/${item.id}`) throw new Error('Source asset identity or byte bound mismatch');
    return { id: Number(item.id), name: item.name, size: Number(item.size), url: String(item.url) };
  });
  if (assets.length !== expected.size || new Set(assets.map(item => item.name)).size !== expected.size) throw new Error('Source asset transport closure mismatch');
  return { assets, immutable: release.immutable === true };
}
async function readback(options: SourceTransport, directory: string, allowDraft: boolean) {
  const response = await lookupGithubRelease(repository(options.repository), sourceArchiveTag(options.pins), options.runner ?? runGithub);
  if (response.exitCode !== 0) throw new Error('Source archive release readback failed: ' + response.stderr);
  const release = releaseAssets(response.stdout, options, allowDraft);
  await mkdir(directory, { mode: 0o700 });
  for (const asset of release.assets) {
    const downloaded = await (options.downloader ?? downloadGithubAsset)(asset, join(directory, asset.name));
    if (!downloaded.ok) throw downloaded.error;
  }
  return release;
}

/** Restore only the exact reviewed byte closure; tag names and declared asset sizes are insufficient alone. */
export async function restoreGithubSources(options: SourceTransport & {
  cacheDir: string; readbackDir: string;
}): Promise<Result<void>> {
  try {
    await readback(options, options.readbackDir, false);
    return await importSourceCache({ inputDir: options.readbackDir, cacheDir: options.cacheDir, pins: options.pins });
  } catch (error) { return err(error instanceof Error ? error : new Error(String(error))); }
}

/** Content-addressed releases are never updated or clobbered; interrupted publication requires reconciliation. */
export async function publishGithubSources(options: SourceTransport & {
  cacheDir: string; workDir: string; producerRevision: string;
}): Promise<Result<{ releaseUrl: string; tag: string; producerRevision: string; serverImmutable: boolean }>> {
  try {
    repository(options.repository);
    if (!/^[a-f0-9]{40}$/.test(options.producerRevision)) throw new Error('Source archive requires an exact producer commit');
    const tag = sourceArchiveTag(options.pins);
    const existing = await lookupGithubRelease(options.repository, tag, options.runner ?? runGithub);
    if (existing.exitCode === 0) throw new Error('Source archive release already exists; restore/read back it instead of overwriting');
    if (!/HTTP 404|Not Found/i.test(existing.stderr)) throw new Error('Cannot establish source release absence');
    await mkdir(options.workDir, { mode: 0o700 });
    const exported = await exportSourceCache({ cacheDir: options.cacheDir, outputDir: join(options.workDir, 'export'), pins: options.pins });
    if (!exported.ok) return exported;
    await ensureProducerTag(options, tag);
    const notes = join(options.workDir, 'release-notes.md');
    await writeFile(notes, 'Original pinned OLRC source input bytes. This archive does not establish enactment, effectivity, legal amendment or full-title text qualification.\n', { flag: 'wx' });
    await command(options, ['release', 'create', tag, ...[...options.pins.map(pin => pin.sha256), 'manifest.json'].map(name => join(options.workDir, 'export', name)),
      '--repo', options.repository, '--target', options.producerRevision, '--draft', '--latest=false', '--title', 'Pinned OLRC Title 18 source inputs', '--notes-file', notes]);
    await readback(options, join(options.workDir, 'draft-readback'), true);
    const verified = await importSourceCache({ inputDir: join(options.workDir, 'draft-readback'), cacheDir: join(options.workDir, 'draft-restore'), pins: options.pins });
    if (!verified.ok) return verified;
    await command(options, ['release', 'edit', tag, '--repo', options.repository, '--draft=false', '--latest=false']);
    const published = await readback(options, join(options.workDir, 'published-readback'), false);
    const restored = await importSourceCache({ inputDir: join(options.workDir, 'published-readback'), cacheDir: join(options.workDir, 'published-restore'), pins: options.pins });
    if (!restored.ok) return restored;
    return ok({ releaseUrl: `https://github.com/${options.repository}/releases/tag/${tag}`, tag,
      producerRevision: options.producerRevision, serverImmutable: published.immutable });
  } catch (error) { return err(error instanceof Error ? error : new Error(String(error))); }
}

async function ensureProducerTag(options: SourceTransport & { producerRevision: string }, tag: string): Promise<void> {
  const runner = options.runner ?? runGithub;
  const response = await runner(['api', `repos/${options.repository}/git/ref/tags/${tag}`]);
  if (response.exitCode !== 0) {
    if (!/HTTP 404|Not Found/i.test(response.stderr)) throw new Error('Cannot inspect source archive tag');
    await command(options, ['api', `repos/${options.repository}/git/refs`, '--method', 'POST',
      '-f', `ref=refs/tags/${tag}`, '-f', `sha=${options.producerRevision}`]);
  }
  const selected: unknown = JSON.parse(await command(options, ['api', `repos/${options.repository}/git/ref/tags/${tag}`]));
  if (!matchesProducer(selected, options.producerRevision)) {
    throw new Error('Source archive producer tag identity mismatch');
  }
}

function matchesProducer(value: unknown, expected: string): boolean {
  if (!value || typeof value !== 'object' || !('object' in value)) return false;
  const target = value.object;
  return !!target && typeof target === 'object' && 'type' in target && target.type === 'commit' &&
    'sha' in target && target.sha === expected;
}

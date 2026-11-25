import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type Result } from '@civic-source/types';
import { adoptSourceBlob, readSourceBlob, type SourceBlobPin } from './olrc-source-cache.js';
import { checkStoreCapacity } from './ecfr-bulk-capacity.js';

export function sourceExportManifest(pins: readonly SourceBlobPin[]): string {
  if (!pins.length || pins.length > 16 || new Set(pins.map(pin => pin.sha256)).size !== pins.length) throw new Error('Invalid source export closure');
  return JSON.stringify({ schemaVersion: 'usct.retained-source-export/v1', blobs: [...pins].sort((a, b) => a.sha256.localeCompare(b.sha256)) }, null, 2) + '\n';
}

async function verifyExport(inputDir: string, pins: readonly SourceBlobPin[]): Promise<void> {
  const expected = sourceExportManifest(pins);
  const names = (await readdir(inputDir)).sort();
  if (JSON.stringify(names) !== JSON.stringify(['manifest.json', ...pins.map(pin => pin.sha256)].sort())) throw new Error('Source export transport closure is incomplete or contains unexpected entries');
  const descriptor = await open(join(inputDir, 'manifest.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await descriptor.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== Buffer.byteLength(expected)) throw new Error('Source export manifest identity mismatch');
    const bytes = Buffer.alloc(stat.size + 1);
    const read = await descriptor.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead !== stat.size || bytes.subarray(0, read.bytesRead).toString('utf8') !== expected) throw new Error('Source export manifest changed or is not the pinned closure');
  } finally { await descriptor.close(); }
  for (const pin of pins) {
    const verified = await readSourceBlob({ cacheDir: inputDir, pin });
    if (!verified.ok) throw verified.error;
  }
}

/** A bounded directory export preserves original archive bytes without recompression or time-dependent metadata. */
export async function exportSourceCache(options: {
  cacheDir: string; outputDir: string; pins: readonly SourceBlobPin[];
}): Promise<Result<{ manifestSha256: string }>> {
  try {
    const manifest = sourceExportManifest(options.pins);
    for (const pin of options.pins) { const read = await readSourceBlob({ cacheDir: options.cacheDir, pin }); if (!read.ok) return read; }
    await mkdir(options.outputDir, { mode: 0o700 });
    const capacity = await checkStoreCapacity(options.outputDir, options.pins.reduce((sum, pin) => sum + pin.byteLength, Buffer.byteLength(manifest)), {});
    if (!capacity.ok) return capacity;
    for (const pin of options.pins) {
      const adopted = await adoptSourceBlob({ cacheDir: options.outputDir, inputPath: join(options.cacheDir, pin.sha256), pin });
      if (!adopted.ok) return adopted;
    }
    const file = await open(join(options.outputDir, 'manifest.json'), 'wx', 0o600);
    try { await file.writeFile(manifest); await file.sync(); } finally { await file.close(); }
    const directory = await open(options.outputDir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
    await verifyExport(options.outputDir, options.pins);
    return ok({ manifestSha256: createHash('sha256').update(manifest).digest('hex') });
  } catch (error) { return err(error instanceof Error ? error : new Error(String(error))); }
}

/** Incomplete imports can retain immutable blobs; no selected catalog or accepted edition is mutated. */
export async function importSourceCache(options: {
  inputDir: string; cacheDir: string; pins: readonly SourceBlobPin[];
}): Promise<Result<void>> {
  try {
    await verifyExport(options.inputDir, options.pins);
    for (const pin of options.pins) {
      const adopted = await adoptSourceBlob({ cacheDir: options.cacheDir, inputPath: join(options.inputDir, pin.sha256), pin });
      if (!adopted.ok) return adopted;
    }
    return ok(undefined);
  } catch (error) { return err(error instanceof Error ? error : new Error(String(error))); }
}

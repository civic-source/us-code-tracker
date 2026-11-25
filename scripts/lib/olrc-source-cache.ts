import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type Result } from '@civic-source/types';
import { checkStoreCapacity } from './ecfr-bulk-capacity.js';

export interface SourceBlobPin { sha256: string; byteLength: number }
const MAX_SOURCE_BYTES = 128 * 1024 ** 2;
const message = (error: unknown): Error => error instanceof Error ? error : new Error(String(error));

function validatePin(pin: SourceBlobPin): void {
  if (!/^[a-f0-9]{64}$/.test(pin.sha256) || !Number.isSafeInteger(pin.byteLength) ||
    pin.byteLength < 1 || pin.byteLength > MAX_SOURCE_BYTES) throw new Error('Invalid retained source byte pin');
}

async function pinnedBytes(path: string, pin: SourceBlobPin): Promise<Buffer> {
  validatePin(pin);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== pin.byteLength) throw new Error('Retained source identity or size mismatch');
    const bounded = Buffer.alloc(pin.byteLength + 1); let length = 0;
    while (length < bounded.length) {
      const read = await file.read(bounded, length, bounded.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    const bytes = bounded.subarray(0, length);
    if (bytes.length !== pin.byteLength || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) {
      throw new Error('Retained source digest mismatch');
    }
    return bytes;
  } finally { await file.close(); }
}

async function rootPath(cacheDir: string): Promise<void> {
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const stat = await lstat(cacheDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0) {
    throw new Error('Retained source cache must be an owned directory without group/world write access');
  }
}

export async function readSourceBlob(options: { cacheDir: string; pin: SourceBlobPin }): Promise<Result<Buffer>> {
  try {
    validatePin(options.pin);
    const stat = await lstat(options.cacheDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid retained source cache directory');
    return ok(await pinnedBytes(join(options.cacheDir, options.pin.sha256), options.pin));
  } catch (error: unknown) { return err(message(error)); }
}

/** Retain verified input bytes without replacing an existing immutable cache object. */
export async function adoptSourceBlob(options: {
  cacheDir: string; inputPath: string; pin: SourceBlobPin;
}): Promise<Result<string>> {
  let stage: string | undefined; let created = false;
  try {
    const bytes = await pinnedBytes(options.inputPath, options.pin);
    await rootPath(options.cacheDir);
    const target = join(options.cacheDir, options.pin.sha256);
    try {
      await lstat(target);
      await pinnedBytes(target, options.pin);
      return ok(target);
    } catch (error: unknown) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    const capacity = await checkStoreCapacity(options.cacheDir, bytes.length, {});
    if (!capacity.ok) return capacity;
    stage = join(options.cacheDir, '.stage-' + randomUUID());
    const file = await open(stage, 'wx', 0o600); created = true;
    try { await file.writeFile(bytes); await file.sync(); }
    finally { await file.close(); }
    await link(stage, target);
    await unlink(stage); stage = undefined;
    const directory = await open(options.cacheDir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
    await pinnedBytes(target, options.pin);
    return ok(target);
  } catch (error: unknown) { return err(message(error)); }
  finally {
    if (stage && created) {
      try { await unlink(stage); }
      catch (error: unknown) { return err(message(error)); }
    }
  }
}

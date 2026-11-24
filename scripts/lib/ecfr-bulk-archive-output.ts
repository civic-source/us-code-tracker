import { constants, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, link, mkdir, open, statfs, unlink } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { err, ok, type EcfrBulkBlob, type Result } from '@civic-source/types';
import { storeError } from './ecfr-bulk-capacity.js';

export interface ArchiveOutputOptions {
  minFreeBytes: number;
  capacityProvider?: (directory: string) => Promise<number>;
}

export async function checkArchiveOutputCapacity(destination: string, bytes: number, options: ArchiveOutputOptions): Promise<Result<void>> {
  try {
    if (![bytes, options.minFreeBytes].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid archive output budget');
    const directory = dirname(resolve(destination)); await mkdir(directory, { recursive: true });
    const fs = options.capacityProvider ? undefined : await statfs(directory, { bigint: true });
    const free = options.capacityProvider ? await options.capacityProvider(directory) : Number(fs!.bavail * fs!.bsize);
    if (!Number.isSafeInteger(free) || free - options.minFreeBytes < bytes) throw new Error('Insufficient disk space on archive output filesystem');
    return ok(undefined);
  } catch (error: unknown) { return err(storeError(error)); }
}

/** Copy to an exclusive sibling, verify and sync it, then publish without replacing a path. */
export async function publishArchiveFile(
  source: string, destination: string, expected: EcfrBulkBlob, options: ArchiveOutputOptions,
): Promise<Result<void>> {
  const directory = dirname(resolve(destination)); const temp = join(directory, '.ecfr-archive-' + randomUUID());
  let result: Result<void>;
  try {
    const capacity = await checkArchiveOutputCapacity(destination, expected.byteLength, options);
    if (!capacity.ok) return capacity;
    await copyFile(source, temp, constants.COPYFILE_EXCL);
    const digest = createHash('sha256'); let length = 0;
    for await (const chunk of createReadStream(temp)) { const bytes = chunk as Buffer; length += bytes.length; digest.update(bytes); }
    if (length !== expected.byteLength || digest.digest('hex') !== expected.sha256) throw new Error('Copied archive failed verification');
    const file = await open(temp, 'r');
    try { await file.sync(); } finally { await file.close(); }
    await link(temp, destination);
    const parent = await open(directory, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
    result = ok(undefined);
  } catch (error: unknown) { result = err(storeError(error)); }
  try { await unlink(temp); }
  catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') return err(storeError(error));
  }
  return result;
}

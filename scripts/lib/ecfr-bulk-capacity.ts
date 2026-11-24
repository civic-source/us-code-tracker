import { lstat, readdir, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type Result } from '@civic-source/types';

export interface EcfrBulkStoreOptions {
  minFreeBytes?: number;
  maxCacheBytes?: number;
  capacityProvider?: () => Promise<number>;
}
export interface StoreCapacity {
  cacheBytes: number;
  freeBytes: number;
  minFreeBytes: number;
  maxCacheBytes: number;
}

export function storeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function validBytes(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

async function diskUsage(path: string): Promise<number> {
  const root = await lstat(path);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Cache root must be a regular directory');
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    const info = await lstat(full);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error('Cache contains a linked or special path');
    total += info.isDirectory() ? await diskUsage(full) : info.size;
    if (!validBytes(total)) throw new Error('Cache usage exceeds safe integer bytes');
  }
  return total;
}

export async function inspectStoreCapacity(cacheDir: string, options: EcfrBulkStoreOptions = {}): Promise<Result<StoreCapacity>> {
  try {
    const minFreeBytes = options.minFreeBytes ?? 2 * 1024 ** 3;
    const maxCacheBytes = options.maxCacheBytes ?? 16 * 1024 ** 3;
    if (![minFreeBytes, maxCacheBytes].every(validBytes)) return err(new Error('Capacity limits must be nonnegative safe integer bytes'));
    const cacheBytes = await diskUsage(cacheDir);
    const measured = options.capacityProvider ? await options.capacityProvider() : await freeBytes(cacheDir);
    if (!validBytes(measured)) return err(new Error('Measured free space must be nonnegative safe integer bytes'));
    return ok({ cacheBytes, freeBytes: measured, minFreeBytes, maxCacheBytes });
  } catch (error: unknown) { return err(storeError(error)); }
}

export async function checkStoreCapacity(
  cacheDir: string, additionalBytes: number, options: EcfrBulkStoreOptions,
): Promise<Result<void>> {
  if (!validBytes(additionalBytes)) return err(new Error('Additional capacity must be nonnegative safe integer bytes'));
  const inspected = await inspectStoreCapacity(cacheDir, options);
  if (!inspected.ok) return inspected;
  const capacity = inspected.value;
  if (capacity.freeBytes - capacity.minFreeBytes < additionalBytes) {
    return err(new Error('Insufficient disk space for eCFR cache and free-space reserve'));
  }
  if (capacity.maxCacheBytes - capacity.cacheBytes < additionalBytes) return err(new Error('eCFR cache quota would be exceeded'));
  return ok(undefined);
}

async function freeBytes(path: string): Promise<number> {
  const fs = await statfs(path, { bigint: true });
  return Number(fs.bavail * fs.bsize);
}

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { EcfrBulkSourceSchema, err, ok, type EcfrBulkSource, type Result } from '@civic-source/types';
import type { EcfrBulkSourceMetadata } from './ecfr-bulk-source.js';
import { canonicalJson, type EcfrBulkStore } from './ecfr-bulk-store.js';

const RECEIPT_LIMIT = 65_536;
const failure = (error: unknown): Error => error instanceof Error ? error : new Error(String(error));
function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
function receiptPath(store: EcfrBulkStore, title: number, url: string): string {
  if (!Number.isInteger(title) || title < 1 || title > 50 ||
      url !== `https://www.govinfo.gov/bulkdata/ECFR/title-${title}/ECFR-title${title}.xml`) {
    throw new Error('Invalid acquisition source identity');
  }
  return join(store.cacheDir, 'acquisitions', `title-${title}.json`);
}
async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, 'r');
  try { await directory.sync(); }
  finally { await directory.close(); }
}
async function readReceipt(path: string): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > RECEIPT_LIMIT) throw new Error('Invalid acquisition receipt file');
    const chunks: Buffer[] = [];
    let byteLength = 0;
    const buffer = Buffer.alloc(8192);
    for (;;) {
      const read = await file.read(buffer, 0, buffer.length, null);
      if (read.bytesRead === 0) break;
      byteLength += read.bytesRead;
      if (byteLength > RECEIPT_LIMIT) throw new Error('Acquisition receipt exceeds byte limit');
      chunks.push(Buffer.from(buffer.subarray(0, read.bytesRead)));
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, byteLength))) as unknown;
  } finally { await file.close(); }
}

/** A retained acquisition is a conditional-request input, never accepted coverage. */
export async function recoverAcquisition(store: EcfrBulkStore, metadata: EcfrBulkSourceMetadata): Promise<Result<EcfrBulkSource | undefined>> {
  try {
    const path = receiptPath(store, metadata.title, metadata.url);
    let raw: unknown;
    try { raw = await readReceipt(path); }
    catch (error: unknown) { if (missing(error)) return ok(undefined); throw error; }
    const source = EcfrBulkSourceSchema.parse(raw);
    if (source.title !== metadata.title || source.url !== metadata.url || source.blob.byteLength === 0) {
      return err(new Error('Acquisition receipt source identity mismatch'));
    }
    const verified = await store.verifyBlob(source.blob);
    return verified.ok ? ok(source) : verified;
  } catch (error: unknown) { return err(failure(error)); }
}

async function writeReceipt(path: string, bytes: Buffer): Promise<void> {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
}

export async function recordAcquisition(store: EcfrBulkStore, source: EcfrBulkSource): Promise<Result<void>> {
  const temp = join(store.stagingDir, randomUUID() + '.acquisition.json');
  let result: Result<void>;
  try {
    const parsed = EcfrBulkSourceSchema.parse(source);
    const path = receiptPath(store, parsed.title, parsed.url);
    if (parsed.blob.byteLength === 0) throw new Error('Acquisition source is empty');
    const verified = await store.verifyBlob(parsed.blob);
    if (!verified.ok) return verified;
    const bytes = Buffer.from(canonicalJson(parsed) + '\n');
    if (bytes.byteLength > RECEIPT_LIMIT) throw new Error('Acquisition receipt exceeds byte limit');
    const capacity = await store.ensureCapacity(bytes.byteLength);
    if (!capacity.ok) return capacity;
    await mkdir(join(store.cacheDir, 'acquisitions'), { recursive: true });
    await writeReceipt(temp, bytes);
    await rename(temp, path);
    await syncDirectory(join(store.cacheDir, 'acquisitions'));
    await syncDirectory(store.stagingDir);
    await syncDirectory(store.cacheDir);
    result = ok(undefined);
  } catch (error: unknown) { result = err(failure(error)); }
  try { await unlink(temp); }
  catch (error: unknown) { if (!missing(error)) return err(failure(error)); }
  return result;
}

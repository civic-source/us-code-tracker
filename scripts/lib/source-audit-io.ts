import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { open, mkdir, lstat, statfs, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const auditSha = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
export const auditJson = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';
const reserve = 2n * 1024n ** 3n;
const quota = 16 * 1024 ** 3;

export async function readAuditInput(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > limit) throw new Error('Audit input is linked, special or oversized');
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length !== info.size) throw new Error('Audit input changed size while reading');
    return bytes.subarray(0, length);
  } finally { await file.close(); }
}

async function capacity(path: string, additional: number): Promise<void> {
  const fs = await statfs(path, { bigint: true });
  if (fs.bavail * fs.bsize < reserve + BigInt(additional)) throw new Error('Audit requires a 2 GiB free-space reserve');
}

export interface AuditWriter {
  root: string; write: (path: string, bytes: string | Buffer) => Promise<void>;
  reserve: (bytes: number) => Promise<void>; adopt: (path: string) => Promise<void>;
}

async function childUsage(path: string): Promise<number> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error('Linked audit worker output');
  if (info.isFile() && info.nlink === 1) return info.size;
  if (!info.isDirectory()) throw new Error('Special audit worker output');
  let total = 0;
  for (const entry of await readdir(path)) total += await childUsage(join(path, entry));
  return total;
}

export async function freshAuditWriter(root: string): Promise<AuditWriter> {
  const parent = await lstat(dirname(root));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid?.() || (parent.mode & 0o022)) {
    throw new Error('Audit output parent must be owned and not group/world writable');
  }
  await capacity(dirname(root), 0);
  await mkdir(root, { mode: 0o700 });
  let written = 0;
  const adopted = new Set<string>();
  const reserveBytes = async (bytes: number) => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || written + bytes > quota) throw new Error('Audit output exceeds 16 GiB quota');
    await capacity(root, bytes);
  };
  return { root, reserve: reserveBytes, async adopt(path) {
    if (!/^[A-Za-z0-9_-]+$/.test(path) || adopted.has(path)) throw new Error('Invalid or duplicate audit worker adoption');
    try { await lstat(join(root, path)); }
    catch (error: unknown) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return; throw error; }
    const bytes = await childUsage(join(root, path));
    if (written + bytes > quota) throw new Error('Audit worker exceeded the 16 GiB quota');
    written += bytes; adopted.add(path);
  }, async write(path, bytes) {
    if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').includes('..')) throw new Error('Unsafe audit output path');
    const size = Buffer.byteLength(bytes);
    await reserveBytes(size);
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const file = await open(target, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    written += size;
  } };
}

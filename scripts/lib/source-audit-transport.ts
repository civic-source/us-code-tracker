import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { auditSha, readAuditInput } from './source-audit-io.js';

export interface AuditPayload { path: string; sha256: string; byteLength: number }
interface TransportBudget { bytes: number; files: number }
export function safeAuditRelative(path: string): boolean {
  return /^[A-Za-z0-9_./-]+$/.test(path) && !path.startsWith('/') && !path.split('/').includes('..');
}

function operational(path: string): boolean {
  return ['audit-manifest.json', 'audit-operation.json', 'inventory.stderr.txt'].includes(path)
    || /^batch-\d{4}(?:-producer\.(?:stdout|stderr)|\.stderr)\.txt$/.test(path)
    || /^batch-\d{4}-candidate\/candidate-manifest\.json$/.test(path);
}

async function requireDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o022)) {
    throw new Error('Audit transport directory is linked, foreign or writable');
  }
}

async function transportEntry(root: string, path: string, budget: TransportBudget): Promise<AuditPayload[]> {
  if (!safeAuditRelative(path)) throw new Error('Unsafe audit transport path');
  const info = await lstat(join(root, path));
  if (info.isSymbolicLink()) throw new Error('Linked audit transport');
  if (info.isDirectory()) return auditTransport(root, path, budget);
  if (!info.isFile() || info.nlink !== 1) throw new Error('Linked or special audit transport');
  budget.bytes += info.size; budget.files++;
  if (budget.bytes > 16 * 1024 ** 3 || budget.files > 200_000) throw new Error('Audit transport exceeds its byte/file quota');
  if (operational(path)) return [];
  const bytes = await readAuditInput(join(root, path), 128 * 1024 ** 2);
  return [{ path, sha256: auditSha(bytes), byteLength: bytes.length }];
}

/** Hash canonical payloads; timing logs and producer subset receipts remain operational artifacts. */
export async function auditTransport(root: string, prefix = '', budget: TransportBudget = { bytes: 0, files: 0 }): Promise<AuditPayload[]> {
  await requireDirectory(join(root, prefix));
  const result: AuditPayload[] = [];
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  for (const entry of entries) result.push(...await transportEntry(root, prefix ? `${prefix}/${entry.name}` : entry.name, budget));
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

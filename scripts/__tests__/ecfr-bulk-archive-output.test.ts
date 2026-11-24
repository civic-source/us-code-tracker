import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { digestBytes } from '../lib/ecfr-bulk-store.js';
import { checkArchiveOutputCapacity, publishArchiveFile } from '../lib/ecfr-bulk-archive-output.js';
const roots: string[] = [];
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'archive-output-')); roots.push(root); const source = join(root, 'source'); await writeFile(source, 'archive'); return { root, source, destination: join(root, 'published'), ref: { sha256: digestBytes('archive'), byteLength: 7 } }; }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
it('checks the destination filesystem and refuses before creating output below reserve', async () => {
  const { source, destination, ref } = await fixture(); let measured = '';
  const options = { minFreeBytes: 10, capacityProvider: async (directory: string) => { measured = directory; return 16; } };
  expect((await checkArchiveOutputCapacity(destination, 7, options)).ok).toBe(false);
  expect((await publishArchiveFile(source, destination, ref, options)).ok).toBe(false);
  expect(measured).toBe(join(destination, '..')); await expect(access(destination)).rejects.toThrow();
});
it('atomically publishes verified output, preserves existing files and cleans sibling staging', async () => {
  const { root, source, destination, ref } = await fixture(); const options = { minFreeBytes: 0 };
  expect((await publishArchiveFile(source, destination, ref, options)).ok).toBe(true);
  expect(await readFile(destination, 'utf8')).toBe('archive');
  await writeFile(source, 'changed');
  expect((await publishArchiveFile(source, destination, { sha256: digestBytes('changed'), byteLength: 7 }, options)).ok).toBe(false);
  expect(await readFile(destination, 'utf8')).toBe('archive');
  expect((await readdir(root)).sort()).toEqual(['published', 'source']);
});
it('rejects source corruption before exposing the final destination', async () => {
  const { root, source, destination, ref } = await fixture();
  expect((await publishArchiveFile(source, destination, { ...ref, sha256: digestBytes('other') }, { minFreeBytes: 0 })).ok).toBe(false);
  await expect(access(destination)).rejects.toThrow(); expect(await readdir(root)).toEqual(['source']);
});

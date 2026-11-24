import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { downloadCommandBounded } from '../lib/ecfr-bulk-archive-download.js';
const roots: string[] = [];
async function output() { const root = await mkdtemp(join(tmpdir(), 'bounded-gh-')); roots.push(root); return join(root, 'asset'); }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
it('bounds real subprocess stdout before extra disk writes and removes partial output', async () => {
  const path = await output();
  const result = await downloadCommandBounded(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(1048576))'], path, 8);
  expect(result.ok).toBe(false); await expect(access(path)).rejects.toThrow();
});
it('accepts exact bytes and rejects truncated streams or existing targets', async () => {
  const path = await output();
  expect((await downloadCommandBounded(process.execPath, ['-e', 'process.stdout.write("data")'], path, 4)).ok).toBe(true);
  expect(await readFile(path, 'utf8')).toBe('data');
  expect((await downloadCommandBounded(process.execPath, ['-e', 'process.stdout.write("evil")'], path, 4)).ok).toBe(false);
  expect(await readFile(path, 'utf8')).toBe('data');
  const short = await output();
  expect((await downloadCommandBounded(process.execPath, ['-e', 'process.stdout.write("x")'], short, 4)).ok).toBe(false);
  await expect(access(short)).rejects.toThrow();
});
it('removes partial output on subprocess failure', async () => {
  const path = await output(); await writeFile(path + '.unrelated', 'keep');
  expect((await downloadCommandBounded(process.execPath, ['-e', 'process.stdout.write("x");process.exit(1)'], path, 1)).ok).toBe(false);
  await expect(access(path)).rejects.toThrow();
  expect(await readFile(path + '.unrelated', 'utf8')).toBe('keep');
});

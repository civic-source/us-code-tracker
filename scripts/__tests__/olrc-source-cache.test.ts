import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { historicalSourcePins } from '../lib/olrc-historical-sources.js';
import { createHash } from 'node:crypto';
import { adoptSourceBlob, readSourceBlob } from '../lib/olrc-source-cache.js';

vi.mock('node:crypto', async (load) => ({ ...await load<typeof import('node:crypto')>(),
  randomUUID: () => '00000000-0000-4000-8000-000000000000' }));

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('immutable retained-source cache', () => {
  it('adopts verified bytes and refuses a corrupt same-size replacement without overwriting prior bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'olrc-cache-')); roots.push(root);
    const input = join(root, 'input'); const cache = join(root, 'cache'); const bytes = Buffer.from('retained source');
    await writeFile(input, bytes);
    const pin = { sha256: digest(bytes), byteLength: bytes.length };
    const first = await adoptSourceBlob({ cacheDir: cache, inputPath: input, pin });
    expect(first.ok).toBe(true);
    if (!first.ok) throw first.error;
    expect(await readFile(first.value)).toEqual(bytes);
    await writeFile(input, Buffer.alloc(bytes.length, 120));
    const changed = await adoptSourceBlob({ cacheDir: cache, inputPath: input, pin });
    expect(changed.ok).toBe(false);
    const replayed = await readSourceBlob({ cacheDir: cache, pin });
    expect(replayed.ok && replayed.value.equals(bytes)).toBe(true);
  });
  it('does not delete a preexisting exclusive-stage collision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'olrc-cache-')); roots.push(root);
    const cache = join(root, 'cache'); await mkdir(cache, { mode: 0o700 });
    const input = join(root, 'input'); const bytes = Buffer.from('verified input'); await writeFile(input, bytes);
    const stage = join(cache, '.stage-00000000-0000-4000-8000-000000000000');
    await writeFile(stage, 'foreign stage');
    const result = await adoptSourceBlob({ cacheDir: cache, inputPath: input,
      pin: { sha256: digest(bytes), byteLength: bytes.length } });
    expect(result.ok).toBe(false);
    expect(await readFile(stage, 'utf8')).toBe('foreign stage');
  });
  it('refuses a symlink source instead of acquiring through a mutable alias', async () => {
    const root = await mkdtemp(join(tmpdir(), 'olrc-cache-')); roots.push(root);
    const input = join(root, 'input'); const bytes = Buffer.from('source'); await writeFile(input, bytes);
    const alias = join(root, 'alias'); await symlink(input, alias);
    const result = await adoptSourceBlob({ cacheDir: join(root, 'cache'), inputPath: alias,
      pin: { sha256: digest(bytes), byteLength: bytes.length } });
    expect(result.ok).toBe(false);
  });
  it('refuses a FIFO retained blob without blocking verified export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'olrc-cache-')); roots.push(root);
    const cache = join(root, 'cache'); await mkdir(cache, { mode: 0o700 });
    for (const source of historicalSourcePins) execFileSync('mkfifo', [join(cache, source.archive.sha256)]);
    const result = spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/historical-source-cache.ts'),
      '--action', 'export', '--cache', cache, '--directory', join(root, 'output')],
    { encoding: 'utf8', timeout: 3_000, maxBuffer: 2 * 1024 ** 2 });
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stderr).toContain('Retained source identity or size mismatch');
  }, 10_000);

});

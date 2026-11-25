import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { adoptSourceBlob } from '../lib/olrc-source-cache.js';
import { exportSourceCache, importSourceCache } from '../lib/olrc-source-export.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'usct-source-export-')); roots.push(root);
  const raw = Buffer.from('retained original bytes'); const source = join(root, 'source'); await writeFile(source, raw);
  const pin = { sha256: createHash('sha256').update(raw).digest('hex'), byteLength: raw.length };
  const cacheDir = join(root, 'cache'); expect((await adoptSourceBlob({ cacheDir, inputPath: source, pin })).ok).toBe(true);
  return { root, cacheDir, pin };
}
it('exports identical pinned bytes and restores after complete local-cache loss without replacing immutable files', async () => {
  const { root, cacheDir, pin } = await fixture(); const first = join(root, 'one'); const second = join(root, 'two');
  expect((await exportSourceCache({ cacheDir, outputDir: first, pins: [pin] })).ok).toBe(true);
  expect((await exportSourceCache({ cacheDir, outputDir: second, pins: [pin] })).ok).toBe(true);
  expect(await readFile(join(first, 'manifest.json'))).toEqual(await readFile(join(second, 'manifest.json')));
  expect(await readFile(join(first, pin.sha256))).toEqual(await readFile(join(second, pin.sha256)));
  expect((await exportSourceCache({ cacheDir, outputDir: first, pins: [pin] })).ok).toBe(false);
  await rm(cacheDir, { recursive: true });
  expect((await importSourceCache({ inputDir: first, cacheDir, pins: [pin] })).ok).toBe(true);
  expect(await readFile(join(cacheDir, pin.sha256))).toEqual(Buffer.from('retained original bytes'));
});
it('verifies closure and all digests before importing missing, unexpected or corrupted transport', async () => {
  for (const mode of ['missing', 'unexpected', 'corrupt']) {
    const { root, cacheDir, pin } = await fixture(); const archive = join(root, 'export');
    expect((await exportSourceCache({ cacheDir, outputDir: archive, pins: [pin] })).ok).toBe(true);
    if (mode === 'missing') await rm(join(archive, pin.sha256));
    if (mode === 'unexpected') await writeFile(join(archive, 'foreign'), 'unreviewed');
    if (mode === 'corrupt') await writeFile(join(archive, pin.sha256), Buffer.alloc(pin.byteLength));
    const restored = join(root, 'restore');
    expect((await importSourceCache({ inputDir: archive, cacheDir: restored, pins: [pin] })).ok).toBe(false);
    await expect(readFile(join(restored, pin.sha256))).rejects.toThrow();
  }
});

import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPinnedOlrcEdition } from '../lib/olrc-historical-sources.js';
import pins from '../../data/olrc-history-pilot/source-pins.json' with { type: 'json' };

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

it('cannot label missing, unknown or corrupted cached bytes as an official historical edition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'olrc-edition-')); roots.push(root);
  expect((await readPinnedOlrcEdition({ cacheDir: root, releaseId: 'pl-119-73' })).ok).toBe(false);
  expect((await readPinnedOlrcEdition({ cacheDir: root, releaseId: 'pl-119-999' })).ok).toBe(false);
  const source = pins.sources[0]!;
  await writeFile(join(root, source.archive.sha256), Buffer.alloc(source.archive.byteLength, 120));
  const result = await readPinnedOlrcEdition({ cacheDir: root, releaseId: source.releaseId });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.message).toContain('digest');
});

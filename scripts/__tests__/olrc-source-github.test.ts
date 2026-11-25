import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ok } from '@civic-source/types';
import { adoptSourceBlob } from '../lib/olrc-source-cache.js';
import { publishGithubSources, restoreGithubSources, sourceArchiveTag } from '../lib/olrc-source-github.js';
import type { GithubRunner } from '../lib/ecfr-bulk-archive-github.js';
import type { GithubAssetDownloader } from '../lib/ecfr-bulk-archive-download.js';

function githubFixture(corrupt: boolean) {
  const repository = 'civic-source/us-code-tracker';
  const assets = new Map<string, Buffer>(); let draft = true; let exists = false; let target = '';
  const commands: string[][] = [];
  const success = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' });
  const missing = () => ({ exitCode: 1, stdout: '', stderr: 'HTTP 404 Not Found' });
  let tag = '';
  const runner: GithubRunner = async args => {
    commands.push([...args]);
    if (args[0] === 'api') {
      if (args[1]!.includes('/git/ref/tags/')) return target ? success(JSON.stringify({ object: { type: 'commit', sha: target } })) : missing();
      if (args[1]!.endsWith('/git/refs')) { target = args.find(item => item.startsWith('sha='))!.slice(4); return success(); }
      if (args[1]!.includes('/releases?')) return success('[]');
      return exists ? success(JSON.stringify({ id: 1, tag_name: tag, draft, immutable: false,
        assets: [...assets].map(([name, bytes], index) => ({ id: index + 1, name, size: bytes.length,
          url: `https://api.github.com/repos/${repository}/releases/assets/${index + 1}` })) })) : missing();
    }
    if (args[1] === 'create') {
      exists = true; tag = args[2]!;
      for (const path of args.slice(3, args.indexOf('--repo'))) assets.set(basename(path), await readFile(path));
      return success();
    }
    if (args[1] === 'edit') { draft = false; return success(); }
    throw new Error('Unexpected GitHub command');
  };
  const downloader: GithubAssetDownloader = async (asset, path) => {
    const original = assets.get(asset.name)!;
    await writeFile(path, corrupt && asset.name !== 'manifest.json' ? Buffer.alloc(original.length) : original, { flag: 'wx' });
    return ok(undefined);
  };
  return { repository, runner, downloader, commands, assets, isDraft: () => draft };
}

for (const corrupt of [false, true]) it(`publishes only after exact byte readback; corruption=${corrupt}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'usct-source-github-'));
  try {
    const bytes = Buffer.from('original source'); const path = join(root, 'source'); await writeFile(path, bytes);
    const pin = { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length };
    const cacheDir = join(root, 'cache'); expect((await adoptSourceBlob({ cacheDir, inputPath: path, pin })).ok).toBe(true);
    const github = githubFixture(corrupt); const options = { ...github, pins: [pin], cacheDir, workDir: join(root, 'publish'), producerRevision: 'a'.repeat(40) };
    const result = await publishGithubSources(options);
    expect(result.ok).toBe(!corrupt);
    expect(github.isDraft()).toBe(corrupt);
    for (const command of github.commands.filter(args => args[1] === 'create' || args[1] === 'edit')) expect(command).toContain('--latest=false');
    if (corrupt) { expect(github.commands.some(args => args[1] === 'edit')).toBe(false); return; }
    expect(result.ok && result.value.tag).toBe(sourceArchiveTag([pin]));
    expect(result.ok && result.value.serverImmutable).toBe(false);
    expect((await publishGithubSources({ ...options, workDir: join(root, 'again') })).ok).toBe(false);
    await rm(cacheDir, { recursive: true });
    expect((await restoreGithubSources({ ...options, readbackDir: join(root, 'fresh-download') })).ok).toBe(true);
    expect(await readFile(join(cacheDir, pin.sha256))).toEqual(bytes);
    github.assets.set('foreign', Buffer.from('extra'));
    expect((await restoreGithubSources({ ...options, readbackDir: join(root, 'foreign-download') })).ok).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

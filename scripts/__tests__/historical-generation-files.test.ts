import * as fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readHistoricalGenerations } from '../lib/historical-qualification.js';

const observation = vi.hoisted(() => ({ afterRealpath: undefined as ((path: string) => void) | undefined }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, realpathSync: (...args: Parameters<typeof actual.realpathSync>) => {
    const result = actual.realpathSync(...args);
    observation.afterRealpath?.(String(args[0]));
    return result;
  } };
});

const source = join(process.cwd(), 'data/olrc-history-pilot');
let directory: string;
let manifest: string;

beforeEach(() => {
  directory = fs.mkdtempSync(join(tmpdir(), 'civic-generation-files-'));
  fs.writeFileSync(join(directory, 'pnpm-lock.yaml'), 'fixture');
  fs.cpSync(source, join(directory, 'data/olrc-history-pilot'), { recursive: true });
  manifest = join(directory, 'data/olrc-history-pilot/generations.json');
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
});
afterEach(() => { observation.afterRealpath = undefined; vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });

describe('historical generation real filesystem admission', () => {
  it('reads a complete regular reviewed registry and all referenced products', () => {
    expect(readHistoricalGenerations().generations).toHaveLength(2);
  });

  it('cannot redirect a checked registry to a replacement symlink', () => {
    const expected = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { active: Record<string, string>; generations: Array<{ recipeSha256: string }> };
    const replacement = structuredClone(expected);
    replacement.active = { 'pl-119-73': expected.generations[0]!.recipeSha256, 'pl-119-142': expected.generations[0]!.recipeSha256 };
    const alternate = join(directory, 'other-registry.json');
    fs.writeFileSync(alternate, JSON.stringify(replacement));
    let swapped = false;
    observation.afterRealpath = path => {
      if (String(path) === manifest && !swapped) {
        swapped = true; fs.renameSync(manifest, manifest + '.original'); fs.symlinkSync(alternate, manifest);
      }
    };
    expect(readHistoricalGenerations().active).toEqual(expected.active);
    expect(swapped).toBe(true);
  });

  it('refuses a registry that grows beyond its bound after metadata admission', () => {
    let grown = false;
    observation.afterRealpath = path => {
      if (String(path) === manifest && !grown) {
        grown = true; fs.appendFileSync(manifest, ' '.repeat(8 * 1024 ** 2));
      }
    };
    expect(() => readHistoricalGenerations()).toThrow();
    expect(grown).toBe(true);
  });

  it('refuses preexisting symlink and hardlinked registry files', () => {
    const original = manifest + '.original'; fs.renameSync(manifest, original);
    fs.symlinkSync(original, manifest);
    expect(() => readHistoricalGenerations()).toThrow();
    fs.unlinkSync(manifest); fs.linkSync(original, manifest);
    expect(() => readHistoricalGenerations()).toThrow();
  });

  it('refuses a FIFO without waiting for a writer', () => {
    fs.unlinkSync(manifest); execFileSync('mkfifo', [manifest]);
    const script = join(directory, 'check.mts');
    const moduleUrl = new URL('../lib/historical-qualification.ts', import.meta.url).href;
    fs.writeFileSync(script, `import { readHistoricalGenerations } from ${JSON.stringify(moduleUrl)};
      process.chdir(${JSON.stringify(directory)});
      let refused = false;
      try { readHistoricalGenerations(); } catch { refused = true; }
      process.stdout.write(refused ? 'refused' : 'accepted');
      process.exit(refused ? 0 : 1);`);
    const result = spawnSync(process.execPath, ['--import', 'tsx', script], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 10_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe('refused');
  });
});

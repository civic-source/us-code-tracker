import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareSourceCorrection } from '../lib/source-correction-candidate.js';

const fixture = new URL('../../packages/transformer/src/__tests__/fixtures/pl-119-142-section-111.xml', import.meta.url);

describe('scoped source correction staging', () => {
  let directory: string;
  let temporaryRoot: string;
  let sourceXml: string;
  let digest: string;
  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'civic-correction-'));
    directory = join(temporaryRoot, 'outputs');
    await mkdir(directory);
    sourceXml = join(temporaryRoot, 'input.xml');
    const sectionFixture = await readFile(fixture, 'utf8');
    // Test-only metadata exercises the release check; acquisition provenance is verified separately.
    const input = sectionFixture.replace('<main>', '<meta><docPublicationName>Online@119-142</docPublicationName></meta><main>');
    await writeFile(sourceXml, input);
    digest = createHash('sha256').update(input).digest('hex');
  });
  afterEach(async () => { await rm(temporaryRoot, { recursive: true, force: true }); });

  function options(output: string) {
    return { sourceXml, expectedSha256: digest, title: '18', sections: ['111'],
      releaseLabel: 'PL 119-142', generatedAt: '2026-11-25T01:20:00.000Z', outputDirectory: join(directory, output) };
  }

  it('reproduces selected Markdown and manifest bytes in two cold output directories', async () => {
    const first = await prepareSourceCorrection(options('first'));
    const second = await prepareSourceCorrection(options('second'));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('Candidate staging failed');
    expect(first.value).toEqual(second.value);
    const path = 'statutes/title-18/chapter-7/section-111.md';
    const one = await readFile(join(directory, 'first', path), 'utf8');
    expect(one).toBe(await readFile(join(directory, 'second', path), 'utf8'));
    expect(one).toContain('generated_at: "2026-11-25T01:20:00.000Z"');
    expect(one).toContain('shall, where the acts in violation');
    expect(first.value.files).toEqual([{ path, sha256: createHash('sha256').update(one).digest('hex') }]);
    expect(await readFile(join(directory, 'first', 'candidate-manifest.json'), 'utf8'))
      .toBe(await readFile(join(directory, 'second', 'candidate-manifest.json'), 'utf8'));
    expect(first.value.state).toBe('candidate');
  });

  it.each([
    { expectedSha256: '0'.repeat(64) }, { sections: ['999999'] }, { sections: ['111', '111'] },
    { generatedAt: 'not-a-date' }, { title: '../18' },
  ])('rejects invalid pinned inputs without creating an output: %j', async (invalid) => {
    const result = await prepareSourceCorrection({ ...options('rejected'), ...invalid });
    expect(result.ok).toBe(false);
    expect(await readdir(directory)).toEqual([]);
  });

  it('refuses existing output and leaves the previous candidate unchanged', async () => {
    const first = await prepareSourceCorrection(options('existing'));
    expect(first.ok).toBe(true);
    const before = await readFile(join(directory, 'existing', 'candidate-manifest.json'), 'utf8');
    const again = await prepareSourceCorrection(options('existing'));
    expect(again.ok).toBe(false);
    expect(await readFile(join(directory, 'existing', 'candidate-manifest.json'), 'utf8')).toBe(before);
  });

  it('refuses attributing the pinned source to a different publisher release', async () => {
    const result = await prepareSourceCorrection({ ...options('wrong-release'), releaseLabel: 'PL 119-141' });
    expect(result.ok).toBe(false);
    expect(await readdir(directory)).toEqual([]);
  });

  it.each(['missing', 'duplicate'])('refuses %s source publication metadata', async (mode) => {
    const original = await readFile(sourceXml, 'utf8');
    const changed = mode === 'missing'
      ? original.replace(/<meta>.*?<\/meta>/s, '')
      : original.replace('</docPublicationName>', '</docPublicationName><docPublicationName>Online@119-142</docPublicationName>');
    await writeFile(sourceXml, changed);
    const result = await prepareSourceCorrection({ ...options('rejected'),
      expectedSha256: createHash('sha256').update(changed).digest('hex') });
    expect(result.ok).toBe(false);
    expect(await readdir(directory)).toEqual([]);
  });

  it.each([
    Buffer.from('<!DOCTYPE uscDoc [<!ENTITY x "injected">]><uscDoc/>'),
    Buffer.from([0xff, 0xfe, 0x00, 0x3c]),
  ])('refuses prohibited or unsupported XML even with a matching byte digest', async (bytes) => {
    const source = join(directory, 'input.xml');
    await writeFile(source, bytes);
    const result = await prepareSourceCorrection({ ...options('rejected'), sourceXml: source,
      expectedSha256: createHash('sha256').update(bytes).digest('hex') });
    expect(result.ok).toBe(false);
    expect(await readdir(directory)).toEqual(['input.xml']);
  });
});

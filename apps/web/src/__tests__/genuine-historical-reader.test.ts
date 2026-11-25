import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { compileHistoricalSection } from '../../../../scripts/lib/olrc-history-materialize.js';
import { readReviewedHistoricalVersions, readActiveHistoricalVersions } from '../../../../scripts/lib/genuine-history-catalog.js';
import { historicalMembership } from '../../../../scripts/lib/historical-qualification.js';
import provenance from '../../../../scripts/__tests__/fixtures/genuine-olrc/provenance.json' with { type: 'json' };

const execute = promisify(execFile);
const root = resolve(process.cwd(), '../..');

function sourceImports(code: string): string {
  return code.replace(/'(?:\.\.\/)+(scripts\/[^']+)'/g,
    (_match, path: string) => JSON.stringify(pathToFileURL(join(root, path + '.ts')).href));
}

async function prepareReader(directory: string): Promise<void> {
  await writeFile(join(directory, 'layout.astro'), '<html lang="en"><head><meta charset="utf-8" /></head><body><article data-pagefind-body><slot /></article></body></html>');
  const component = sourceImports(await readFile('src/components/HistoricalReader.astro', 'utf8'))
    .replace("'../layouts/BaseLayout.astro'", JSON.stringify(join(directory, 'layout.astro')));
  await writeFile(join(directory, 'reader.astro'), component);
  for (const route of ['history/[release]/[title]/[section].astro', 'history/collection/[collection]/[title]/[section].astro']) {
    const destination = join(directory, 'src/pages', route);
    await mkdir(join(destination, '..'), { recursive: true });
    const code = sourceImports(await readFile(join('src/pages', route), 'utf8'))
      .replace(/'(?:\.\.\/)+components\/HistoricalReader.astro'/, JSON.stringify(join(directory, 'reader.astro')));
    await writeFile(destination, code);
  }
  await writeFile(join(directory, 'src/pages/current.astro'), '<html lang="en"><body><article data-pagefind-body>Current-only sentinel</article></body></html>');
  await writeFile(join(directory, 'astro.config.mjs'), 'import { defineConfig } from "astro/config"; export default defineConfig({base:"/us-code-tracker/",site:"https://local.invalid"});');
}

async function independentWitness(path: string, fixture: typeof provenance.records[number]): Promise<void> {
  const input = join(root, 'scripts/__tests__/fixtures/genuine-olrc', fixture.fixture);
  const xml = await readFile(input, 'utf8');
  expect(createHash('sha256').update(xml).digest('hex')).toBe(fixture.fixtureSha256);
  const witness = await execute('python3', [join(root, 'scripts/python/uslm_fidelity.py'), '--xml', input,
    '--html', path, '--section', `/us/usc/t18/s${fixture.section}`, '--expected-source-sha256', fixture.fixtureSha256]);
  expect(JSON.parse(witness.stdout).accepted).toBe(true);
}

type HistoricalVersion = Awaited<ReturnType<typeof readReviewedHistoricalVersions>>[number];
async function immutableReaderWitness(directory: string, version: HistoricalVersion): Promise<void> {
  const proof = version.sourceQualification!;
  const collection = historicalMembership(version).sourceReleaseId;
  const fixture = provenance.records.find(item => item.releaseId === proof.releaseId && item.section === version.uscSection)!;
  const path = join(directory, 'dist/history/collection', collection, '18', version.uscSection, 'index.html');
  const html = await readFile(path, 'utf8');
  expect(html).toContain(`data-collection-id="${collection}"`);
  expect(html).toContain('3 of 1399');
  expect(html).toContain(`/history/collection/${collection}/18/1114/`);
  expect(html.match(/<article id="current-statute-body"[^>]*>([\s\S]*?)<\/article>/)?.[1]).toBe(version.renderedHtml);
  await independentWitness(path, fixture);
}

async function activeReaderWitness(directory: string, version: HistoricalVersion): Promise<void> {
  const proof = version.sourceQualification!;
  const path = join(directory, 'dist/history', proof.releaseId, '18', version.uscSection, 'index.html');
  const html = await readFile(path, 'utf8');
  expect(html).toContain(`data-collection-id="${historicalMembership(version).sourceReleaseId}"`);
  expect(html).toContain('explicitly selected reviewed generation');
  const fixture = provenance.records.find(item => item.releaseId === proof.releaseId && item.section === version.uscSection)!;
  const compiled = await compileHistoricalSection({ xml: await readFile(join(root, 'scripts/__tests__/fixtures/genuine-olrc', fixture.fixture), 'utf8'),
    releaseId: fixture.releaseId, section: fixture.section });
  if (!compiled.ok) throw compiled.error;
  expect(compiled.value.bodyMarkdown).toBe(version.bodyMarkdown);
  expect(compiled.value.renderedHtml).toBe(version.renderedHtml);
  await independentWitness(path, fixture);
}

describe('actual static historical reader templates', () => {
  it('builds twelve immutable generation pages and six explicit active aliases with source witnesses', async () => {
    await mkdir(join(process.cwd(), '.workbench'), { recursive: true });
    const directory = await mkdtemp(join(process.cwd(), '.workbench/historical-reader-'));
    try {
      await prepareReader(directory);
      await execute('pnpm', ['exec', 'astro', 'build', '--root', directory], { timeout: 60_000, maxBuffer: 2 * 1024 ** 2 });
      const indexed = await execute('pnpm', ['exec', 'pagefind', '--site', join(directory, 'dist')], { timeout: 30_000, maxBuffer: 2 * 1024 ** 2 });
      expect(indexed.stdout).toMatch(/Indexed 1 page/);
      const versions = await readReviewedHistoricalVersions();
      const active = await readActiveHistoricalVersions();
      expect(versions).toHaveLength(12); expect(active).toHaveLength(6);
      const files = await readdir(join(directory, 'dist/history'), { recursive: true });
      expect(files.filter(path => path.endsWith('index.html'))).toHaveLength(18);
      for (const version of versions) await immutableReaderWitness(directory, version);
      for (const version of active) await activeReaderWitness(directory, version);
      await expect(readFile(join(directory, 'dist/history/collection', `olrc-pilot-${'f'.repeat(64)}`, '18/111/index.html'))).rejects.toMatchObject({ code: 'ENOENT' });
      const known = historicalMembership(versions[0]!).sourceReleaseId;
      await expect(readFile(join(directory, 'dist/history/collection', known, '18/999999/index.html'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(directory, { recursive: true }); }
  }, 90_000);
});

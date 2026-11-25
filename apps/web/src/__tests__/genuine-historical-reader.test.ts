import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { compileHistoricalSection } from '../../../../scripts/lib/olrc-history-materialize.js';
import materialized from '../../../../data/olrc-history-pilot/materializations.json' with { type: 'json' };
import provenance from '../../../../scripts/__tests__/fixtures/genuine-olrc/provenance.json' with { type: 'json' };

const execute = promisify(execFile);
const root = resolve(process.cwd(), '../..');

describe('actual static historical reader template', () => {
  it('builds six edition-specific cold pages and independently checks every text lane and list parent', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.workbench/historical-reader-'));
    try {
      const pages = join(directory, 'src/pages/history/[release]/[title]'); await mkdir(pages, { recursive: true });
      await writeFile(join(directory, 'layout.astro'), '<html lang="en"><head><meta charset="utf-8" /></head><body><article data-pagefind-body><slot /></article></body></html>');
      let route = await readFile('src/pages/history/[release]/[title]/[section].astro', 'utf8');
      route = route.replace("'../../../../layouts/BaseLayout.astro'", JSON.stringify(join(directory, 'layout.astro')))
        .replace(/'\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/(scripts\/[^']+)'/g,
          (_match, path: string) => JSON.stringify(pathToFileURL(join(root, path + '.ts')).href));
      await writeFile(join(pages, '[section].astro'), route);
      await writeFile(join(directory, 'src/pages/current.astro'), '<html lang="en"><body><article data-pagefind-body>Current-only sentinel</article></body></html>');
      await writeFile(join(directory, 'astro.config.mjs'), 'import { defineConfig } from "astro/config"; export default defineConfig({base:"/us-code-tracker/",site:"https://local.invalid"});');
      await execute('pnpm', ['exec', 'astro', 'build', '--root', directory], { timeout: 60_000, maxBuffer: 2 * 1024 ** 2 });
      const indexed = await execute('pnpm', ['exec', 'pagefind', '--site', join(directory, 'dist')], { timeout: 30_000, maxBuffer: 2 * 1024 ** 2 });
      expect(indexed.stdout).toMatch(/Indexed 1 page/);
      for (const fixture of provenance.records) {
        const input = join(root, 'scripts/__tests__/fixtures/genuine-olrc', fixture.fixture);
        const xml = await readFile(input, 'utf8');
        expect(createHash('sha256').update(xml).digest('hex')).toBe(fixture.fixtureSha256);
        const compiled = await compileHistoricalSection({ xml, releaseId: fixture.releaseId, section: fixture.section });
        if (!compiled.ok) throw compiled.error;
        const original = materialized.records.find(item => item.version.sourceQualification.releaseId === fixture.releaseId && item.version.uscSection === fixture.section)!;
        expect(compiled.value.bodyMarkdown).toBe(original.version.bodyMarkdown);
        expect(compiled.value.renderedHtml).toBe(original.version.renderedHtml);
        const path = join(directory, 'dist/history', fixture.releaseId, '18', fixture.section, 'index.html');
        const html = await readFile(path, 'utf8');
        expect(html).toContain(`data-release-id="${fixture.releaseId}"`);
        expect(html).toContain('3 of 1399');
        expect(html).toContain(`/history/${fixture.releaseId}/18/1114/`);
        const witness = await execute('python3', [join(root, 'scripts/python/uslm_fidelity.py'), '--xml', input,
          '--html', path, '--section', `/us/usc/t18/s${fixture.section}`, '--expected-source-sha256', fixture.fixtureSha256]);
        expect(JSON.parse(witness.stdout).accepted).toBe(true);
      }
    } finally { await rm(directory, { recursive: true }); }
  }, 90_000);
});

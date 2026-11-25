import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { XmlToMarkdownAdapter } from '../../../../packages/transformer/src/index.js';
import { statuteMarkdown } from '../lib/anchored-entry';

const exec = promisify(execFile);
it('builds the real viewer with the corrected source body present and a cold-reader edition disclosure', async () => {
  const web = fileURLToPath(new URL('../../', import.meta.url));
  await mkdir(join(web, '.workbench'), { recursive: true });
  const root = await mkdtemp(join(web, '.workbench/revision-fixture-'));
  try {
    const xml = await readFile(new URL('../../../../packages/transformer/src/__tests__/fixtures/pl-119-142-section-1001.xml', import.meta.url), 'utf8');
    const transformed = new XmlToMarkdownAdapter('PL 119-142').transform(xml);
    if (!transformed.ok) throw transformed.error;
    const body = transformed.value.replace(/^---\n[\s\S]*?\n---\n/, '');
    const html = (await (await statuteMarkdown.createRenderer({})).render(body)).code;
    await writeFile(join(root, 'body.json'), JSON.stringify({ body, html }));
    await symlink(join(web, 'node_modules'), join(root, 'node_modules'));
    await mkdir(join(root, 'src/pages'), { recursive: true });
    const component = fileURLToPath(new URL('./fixtures/revision-reader.astro', import.meta.url));
    await writeFile(join(root, 'src/pages/index.astro'), `---\nimport Fixture from ${JSON.stringify(component)};\nimport {readFileSync} from 'node:fs';\nconst props=JSON.parse(readFileSync(${JSON.stringify(join(root, 'body.json'))},'utf8'));\n---\n<Fixture {...props} />`);
    await writeFile(join(root, 'astro.config.mjs'), "import {defineConfig} from 'astro/config';import svelte from '@astrojs/svelte';export default defineConfig({base:'/us-code-tracker/',integrations:[svelte()]});");
    await exec('pnpm', ['exec', 'astro', 'build', '--root', root], { cwd: web, timeout: 60_000, maxBuffer: 1024 ** 2 });
    const page = await readFile(join(root, 'dist/index.html'), 'utf8');
    expect(page).toContain('shall be fined under this title');
    expect(page).not.toContain('data-current-source-fallback');
    expect(page).toContain('data-edition-query-unavailable');
    expect(page).toContain('pl-119-142-rev2');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 90_000);

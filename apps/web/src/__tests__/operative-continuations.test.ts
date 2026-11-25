import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import sanitizeHtml from 'sanitize-html';
import type { unified } from '@astrojs/markdown-remark';
import astroConfig from '../../astro.config.mjs';
import { XmlToMarkdownAdapter } from '../../../../packages/transformer/src/index.js';
import witnesses from '../../../../packages/transformer/src/__tests__/fixtures/pl-119-142-witnesses.json' with { type: 'json' };

function configuredProcessor(markdown: unknown): ReturnType<typeof unified> {
  if (!markdown || typeof markdown !== 'object' || !('unified' in markdown)) {
    throw new Error('Production Markdown processor is missing');
  }
  const processor = markdown.unified;
  if (!processor || typeof processor !== 'object' || !('createRenderer' in processor)
    || typeof processor.createRenderer !== 'function') {
    throw new Error('Production Markdown renderer is unavailable');
  }
  return processor as ReturnType<typeof unified>;
}

function assertWitness(code: string, witness: typeof witnesses.sections[number]): void {
  expect(code.split(witness.continuation)).toHaveLength(2);
  expect(code.indexOf(witness.continuation)).toBeLessThan(code.indexOf('<strong>(b)</strong>'));
  const segments: string[] = [];
  sanitizeHtml(code.split('<h2')[0]!, {
    allowedTags: [],
    textFilter: (text) => { segments.push(text); return text; },
  });
  expect(segments.join('').replace(/\s+/g, ' ').trim()).toBe(witness.operativeText);
}

function verifyIndependentGate(
  code: string,
  witness: Pick<typeof witnesses.sections[number], 'section' | 'fixture' | 'fixtureSha256'>,
  accepted: boolean,
): void {
  const temporary = mkdtempSync(join(tmpdir(), 'civic-source-witness-'));
  try {
    const html = join(temporary, 'page.html');
    writeFileSync(html, code);
    const script = fileURLToPath(new URL('../../../../scripts/python/uslm_fidelity.py', import.meta.url));
    const xml = fileURLToPath(new URL(
      `../../../../packages/transformer/src/__tests__/fixtures/${witness.fixture}`, import.meta.url,
    ));
    const result = spawnSync('python3', [script, '--xml', xml, '--html', html,
      '--section', `/us/usc/t18/s${witness.section}`, '--expected-source-sha256', witness.fixtureSha256,
      '--fragment'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 65_536 });
    expect(result.status, result.stderr || result.stdout).toBe(accepted ? 0 : 1);
    expect(JSON.parse(result.stdout) as unknown).toMatchObject({ accepted, html_kind: 'renderer_fragment' });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

describe('official operative continuations in the production Markdown renderer', () => {
  it('checks section 19 prose and its editorial/source-credit lanes with the independent gate', async () => {
    const witness = witnesses.paragraphControls[0]!;
    const xml = readFileSync(new URL(
      `../../../../packages/transformer/src/__tests__/fixtures/${witness.fixture}`, import.meta.url,
    ), 'utf8');
    const result = new XmlToMarkdownAdapter('PL 119-142').transform(xml);
    if (!result.ok) throw result.error;
    const renderer = await configuredProcessor(astroConfig.markdown).createRenderer({});
    const { code } = await renderer.render(result.value.split('---').slice(2).join('---'));
    verifyIndependentGate(code, witness, true);
  });

  it('runs independent gate controls for provenance, semantic lanes, repeated text and unsupported structure', () => {
    const directory = fileURLToPath(new URL('../../../../scripts/python/', import.meta.url));
    const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', directory,
      '-p', 'test_uslm_fidelity.py'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 65_536 });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toMatch(/Ran [1-9][0-9]* tests/);
  });

  for (const witness of witnesses.sections) {
    describe(`section ${witness.section}`, () => {
      let code: string;
      beforeAll(async () => {
        const xml = readFileSync(new URL(
          `../../../../packages/transformer/src/__tests__/fixtures/${witness.fixture}`, import.meta.url,
        ), 'utf8');
        const result = new XmlToMarkdownAdapter('PL 119-142').transform(xml);
        if (!result.ok) throw result.error;
        const body = result.value.split('---').slice(2).join('---');
        const renderer = await configuredProcessor(astroConfig.markdown).createRenderer({});
        code = (await renderer.render(body)).code;
      });

      it('retains all three source lanes and the continuation parent', () => {
        assertWitness(code, witness);
        verifyIndependentGate(code, witness, true);
        const editorialSegments: string[] = [];
        sanitizeHtml(code.split('<h2 id="notes">Notes</h2>')[1] ?? '', {
          allowedTags: [],
          textFilter: (text) => { editorialSegments.push(text); return text; },
        });
        expect(editorialSegments.join('').replace(/\s+/g, ' ').trim()).toBe(witness.editorialNotesText);
        const creditSegments: string[] = [];
        const creditLane = code.split('<h2 id="source-credit">Source Credit</h2>')[1]?.split('<h2')[0] ?? '';
        sanitizeHtml(creditLane, {
          allowedTags: [],
          textFilter: (text) => { creditSegments.push(text); return text; },
        });
        expect(creditSegments.join('').replace(/\s+/g, ' ').trim()).toBe(witness.sourceCreditText);
      });

      it.each(['dropped negation', 'moved to (b)', 'moved into notes', 'duplicated in notes', 'detached marker'])(
        'rejects %s', (name) => {
          const paragraph = `<p>${witness.continuation}</p>`;
          const without = code.replace(paragraph, '');
          const mutations: Record<string, string> = {
            'dropped negation': code.replace(witness.continuation, witness.continuation.replace('not ', '')),
            'moved to (b)': without.replace('<strong>(b)</strong>', `<strong>(b)</strong>${paragraph}`),
            'moved into notes': `${without}<h2>Notes</h2>${paragraph}`,
            'duplicated in notes': `${code}<h2>Notes</h2>${paragraph}`,
            'detached marker': code.replace('<strong>(a)</strong>', '').replace('<strong>(b)</strong>', '<strong>(a)</strong><strong>(b)</strong>'),
          };
          const mutation = mutations[name]!;
          expect(() => assertWitness(mutation, witness)).toThrow();
          verifyIndependentGate(mutation, witness, false);
        },
      );
    });
  }
});

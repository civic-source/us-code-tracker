import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
  expect(code).toContain(`</ul>\n<p>${witness.continuation}</p>\n</li>\n<li>`);
  expect(code.split(witness.continuation)).toHaveLength(2);
  expect(code.indexOf(witness.continuation)).toBeLessThan(code.indexOf('<strong>(b)</strong>'));
  const segments: string[] = [];
  sanitizeHtml(code.split('<h2')[0]!, {
    allowedTags: [],
    textFilter: (text) => { segments.push(text); return text; },
  });
  expect(segments.join('').replace(/\s+/g, ' ').trim()).toBe(witness.operativeText);
}

describe('official operative continuations in the production Markdown renderer', () => {
  for (const witness of witnesses.sections) {
    it(`renders section ${witness.section}(a)'s continuation in its parent list item before (b)`, async () => {
      const xml = readFileSync(new URL(
        `../../../../packages/transformer/src/__tests__/fixtures/${witness.fixture}`, import.meta.url,
      ), 'utf8');
      const result = new XmlToMarkdownAdapter('PL 119-142').transform(xml);
      if (!result.ok) throw result.error;
      const body = result.value.split('---').slice(2).join('---');
      const renderer = await configuredProcessor(astroConfig.markdown).createRenderer({});
      const { code } = await renderer.render(body);
      assertWitness(code, witness);
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
      const paragraph = `<p>${witness.continuation}</p>`;
      const without = code.replace(paragraph, '');
      const mutations = [
        code.replace(witness.continuation, witness.continuation.replace('not ', '')),
        without.replace('<strong>(b)</strong>', `<strong>(b)</strong>${paragraph}`),
        `${without}<h2>Notes</h2>${paragraph}`,
        `${code}<h2>Notes</h2>${paragraph}`,
        code.replace('<strong>(a)</strong>', '').replace('<strong>(b)</strong>', '<strong>(a)</strong><strong>(b)</strong>'),
      ];
      for (const mutation of mutations) expect(() => assertWitness(mutation, witness)).toThrow();
    });
  }
});

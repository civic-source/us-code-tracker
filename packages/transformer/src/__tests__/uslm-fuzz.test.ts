/**
 * Property-based fuzzing suite for `@civic-source/transformer` USLM XML parsing
 * and Markdown generation (`civic-source/us-code-tracker#330`, Scorecard FuzzingID).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  MAX_NESTING_DEPTH,
  XmlToMarkdownAdapter,
  generateMarkdownForSection,
  parseUslmXml,
} from '../index.js';

const NUM_RUNS = 100;

const SAFE_SEGMENT = fc
  .stringMatching(/^[a-zA-Z0-9]{1,8}$/)
  .filter((s) => s.length > 0);

const SAFE_SECTION_NUM = fc.stringMatching(/^[1-9][a-zA-Z0-9]{0,7}$/);

const PLAIN_TEXT = fc
  .string({ unit: 'binary', minLength: 1, maxLength: 120 })
  .map((s) =>
    [...s]
      .map((ch) => {
        const code = ch.charCodeAt(0);
        return code < 0x20 || code === 0x7f || '<>&"\'\\'.includes(ch) ? ' ' : ch;
      })
      .join('')
      .trim()
  )
  .map((s) => (s.length > 0 ? s : 'Statutory provision text.'));

function buildFuzzSectionXml(opts: {
  titleNum: string;
  chapterNum: string;
  sectionNum: string;
  heading: string;
  paragraphs: string[];
  nestingDepth: number;
}): string {
  const openNested = Array.from(
    { length: opts.nestingDepth },
    (_, i) => `<paragraph identifier="/us/usc/t${opts.titleNum}/s${opts.sectionNum}/p${i}"><num>(${i + 1})</num><content>Level ${i}</content>`
  ).join('');
  const closeNested = '</paragraph>'.repeat(opts.nestingDepth);
  const body = opts.paragraphs
    .map(
      (text, idx) =>
        `<subsection identifier="/us/usc/t${opts.titleNum}/s${opts.sectionNum}/${String.fromCharCode(97 + idx)}"><num>(${String.fromCharCode(97 + idx)})</num><content>${text}</content>${idx === 0 ? openNested + closeNested : ''}</subsection>`
    )
    .join('');

  return `<lawDoc>
  <title identifier="/us/usc/t${opts.titleNum}">
    <num>Title ${opts.titleNum}</num>
    <chapter identifier="/us/usc/t${opts.titleNum}/ch${opts.chapterNum}">
      <num>Chapter ${opts.chapterNum}</num>
      <section identifier="/us/usc/t${opts.titleNum}/s${opts.sectionNum}">
        <num>${opts.sectionNum}</num>
        <heading>${opts.heading}</heading>
        ${body}
      </section>
    </chapter>
  </title>
</lawDoc>`;
}

describe('USLM property-based fuzzing (@civic-source/transformer)', () => {
  it('parseUslmXml never throws uncaught exceptions on arbitrary or malformed XML strings', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 2048 }),
          fc.string({ unit: 'binary', maxLength: 2048 })
        ),
        (arbitraryInput) => {
          const result = parseUslmXml(arbitraryInput);
          expect(typeof result.ok).toBe('boolean');
          if (!result.ok) {
            expect(result.error).toBeInstanceOf(Error);
          }
        }
      ),
      { numRuns: NUM_RUNS, seed: 20261123 }
    );
  });

  it('XmlToMarkdownAdapter.transformToFiles never throws and emits traversal-safe relative paths', () => {
    const hostileToken = fc.oneof(
      fc.string({ maxLength: 64 }),
      fc.string({ unit: 'binary', maxLength: 64 }),
      fc.constant('../..'),
      fc.constant('/etc/passwd'),
      fc.constant('18\u0000/../../evil'),
      fc.constant('<script>alert(1)</script>')
    );

    fc.assert(
      fc.property(
        hostileToken,
        hostileToken,
        hostileToken,
        fc.string({ unit: 'binary', maxLength: 512 }),
        (t, c, s, payload) => {
          const xml = `<lawDoc><title identifier="/us/usc/t${t}"><num>${t}</num><chapter identifier="/us/usc/t${t}/ch${c}"><num>${c}</num><section identifier="/us/usc/t${t}/s${s}"><num>${s}</num><content>${payload}</content></section></chapter></title></lawDoc>`;
          const adapter = new XmlToMarkdownAdapter('PL 119-73');
          const result = adapter.transformToFiles(xml);
          expect(typeof result.ok).toBe('boolean');
          if (result.ok) {
            for (const file of result.value) {
              expect(file.path).toMatch(/^statutes\/title-[^/\\]+\/chapter-[^/\\]+\/section-[^/\\]+\.md$/);
              expect(file.path).not.toContain('..');
              expect(file.path).not.toContain('\0');
            }
          }
        }
      ),
      { numRuns: NUM_RUNS, seed: 20261124 }
    );
  });

  it('produces deterministic Markdown bodies and normalizedContentHash for valid USLM structures', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 54 }).map(String),
        fc.integer({ min: 1, max: 99 }).map(String),
        SAFE_SECTION_NUM,
        PLAIN_TEXT,
        fc.array(PLAIN_TEXT, { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 0, max: 12 }),
        (titleNum, chapterNum, sectionNum, heading, paragraphs, nestingDepth) => {
          const xml = buildFuzzSectionXml({
            titleNum,
            chapterNum,
            sectionNum,
            heading,
            paragraphs,
            nestingDepth,
          });
          const a = new XmlToMarkdownAdapter('PL 119-73').transformToFiles(xml);
          const b = new XmlToMarkdownAdapter('PL 119-142').transformToFiles(xml);
          expect(a.ok).toBe(true);
          expect(b.ok).toBe(true);
          if (a.ok && b.ok) {
            expect(a.value).toHaveLength(1);
            expect(b.value).toHaveLength(1);
            expect(a.value[0]?.path).toBe(`statutes/title-${titleNum}/chapter-${chapterNum}/section-${sectionNum}.md`);
            expect(a.value[0]?.normalizedContentHash).toBeDefined();
            expect(a.value[0]?.normalizedContentHash).toBe(b.value[0]?.normalizedContentHash);
          }
        }
      ),
      { numRuns: 50, seed: 20261125 }
    );
  });

  it('enforces entity-expansion cap across fuzzed DOCTYPE counts above 128', () => {
    fc.assert(
      fc.property(fc.integer({ min: 129, max: 180 }), SAFE_SEGMENT, (entityCount, val) => {
        const decls = Array.from({ length: entityCount }, (_, i) => `<!ENTITY e${i} "${val}">`).join('\n');
        const xml = `<?xml version="1.0"?><!DOCTYPE uscDoc [${decls}]><uscDoc>&e0;</uscDoc>`;
        const result = parseUslmXml(xml);
        expect(result.ok).toBe(false);
      }),
      { numRuns: 20, seed: 20261126 }
    );
  });

  it('bounds deeply nested USLM subdivision recursion past MAX_NESTING_DEPTH without crashing', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 35 }), SAFE_SEGMENT, (depth, sec) => {
        let nested: unknown[] = [{ content: [{ '#text': 'Leaf clause' }] }];
        for (let i = depth; i >= 1; i--) {
          nested = [
            { num: [{ '#text': `(${i})` }] },
            { paragraph: nested },
          ];
        }
        const sectionChildren = [{ heading: [{ '#text': 'Nested fuzz section' }] }, ...nested];
        const file = generateMarkdownForSection(sectionChildren, '18', '1', sec, 'PL 119-73');
        expect(file.path).toBe(`statutes/title-18/chapter-1/section-${sec}.md`);
        expect(file.content).toContain('usc_title: 18');
        if (depth > MAX_NESTING_DEPTH + 2) {
          expect(file.content).not.toContain(`(${depth})`);
        }
      }),
      { numRuns: 30, seed: 20261127 }
    );
  });
});

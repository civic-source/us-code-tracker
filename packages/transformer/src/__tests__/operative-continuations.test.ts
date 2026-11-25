import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { XmlToMarkdownAdapter } from '../index.js';
import witnesses from './fixtures/pl-119-142-witnesses.json' with { type: 'json' };

describe('official PL 119-142 operative continuations', () => {
  for (const witness of witnesses.sections) {
    it(`retains section ${witness.section}(a)'s complete continuation before (b) exactly once`, () => {
      const xml = readFileSync(new URL(`./fixtures/${witness.fixture}`, import.meta.url), 'utf8');
      const result = new XmlToMarkdownAdapter('PL 119-142').transformToFiles(xml);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.value).toHaveLength(1);
      const markdown = result.value[0]!.content.replace(/\s+/g, ' ');
      const operative = markdown.split('## Source Credit')[0]!;
      expect(operative.split(witness.continuation)).toHaveLength(2);
      expect(operative.indexOf(witness.continuation)).toBeGreaterThan(
        operative.indexOf(witness.section === '111' ? '**(2)**' : '**(3)**'),
      );
      expect(operative.indexOf(witness.continuation)).toBeLessThan(operative.indexOf('**(b)**'));
      expect(witness.continuation.split(' ')).toHaveLength(witness.wordCount);
    });
  }

  it('keeps the official subsection heading attached to its own marker with source punctuation', () => {
    const xml = readFileSync(new URL('./fixtures/pl-119-142-section-111.xml', import.meta.url), 'utf8');
    const result = new XmlToMarkdownAdapter('PL 119-142').transform(xml);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value).toContain('- **(a)** In General.— Whoever—');
    expect(result.value).toContain('- **(b)** Enhanced Penalty.— Whoever,');
    expect(result.value).toContain('- **(c)** Extraterritorial Jurisdiction.— There is');
  });

  it('preserves section 19 prose containing parenthesized citation suffixes as prose', () => {
    const control = witnesses.paragraphControls[0]!;
    const xml = readFileSync(new URL(`./fixtures/${control.fixture}`, import.meta.url), 'utf8');
    const result = new XmlToMarkdownAdapter('PL 119-142').transform(xml);
    if (!result.ok) throw result.error;
    expect(result.value).toContain(control.content);
    expect(result.value).not.toContain('- **(7)**');
  });

  it('retains the official notes wrapper as editorial matter after operative text', () => {
    const xml = readFileSync(new URL('./fixtures/pl-119-142-section-111.xml', import.meta.url), 'utf8');
    const result = new XmlToMarkdownAdapter('PL 119-142').transformToFiles(xml);
    if (!result.ok) throw result.error;
    const file = result.value[0]!;
    expect(file.notes?.some((note) => note.heading === 'Amendments' && note.role === 'amendment')).toBe(true);
    const [operative, notes] = file.content.split('## Notes');
    expect(notes).toContain('Historical and Revision Notes');
    expect(notes).toContain('Amendments');
    expect(operative).not.toContain('Historical and Revision Notes');
  });
});

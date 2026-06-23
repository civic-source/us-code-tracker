/**
 * Tests for xml-utils text extraction, including HTML-escaping of extracted
 * statute text (#200/H2 — defense against stored XSS in the rendered Markdown).
 */

import { describe, it, expect } from 'vitest';
import { extractTextFromNodes } from '../xml-utils.js';

describe('extractTextFromNodes', () => {
  it('concatenates #text nodes in order and collapses whitespace', () => {
    const nodes = [{ '#text': 'Hello   world' }, { '#text': ' again' }];
    expect(extractTextFromNodes(nodes)).toBe('Hello world again');
  });

  it('escapes raw < and > so extracted text cannot inject HTML', () => {
    // The parser decodes XML entities, so a source `&lt;img ...&gt;` arrives
    // here as the literal characters below.
    const nodes = [{ '#text': '<img src=x onerror=alert(1)>' }];
    const out = extractTextFromNodes(nodes);
    expect(out).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });

  it('does not double-escape across nested element nodes', () => {
    // A `<` inside a nested element must be escaped exactly once, not turned
    // into `&amp;lt;` by the recursive walk.
    const nodes = [{ p: [{ '#text': 'a < b' }] }];
    expect(extractTextFromNodes(nodes)).toBe('a &lt; b');
  });

  it('leaves ampersands untouched (no entity double-encoding)', () => {
    const nodes = [{ '#text': 'Smith & Co' }];
    expect(extractTextFromNodes(nodes)).toBe('Smith & Co');
  });
});

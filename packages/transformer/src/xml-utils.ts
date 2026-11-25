/**
 * Utilities for walking fast-xml-parser preserveOrder output.
 *
 * With preserveOrder: true, the parser returns arrays of single-key objects:
 *   [{ tag: [...children] }, { "#text": "..." }, { tag2: [...] }]
 * Attributes live in a ":@" sibling key on the same object.
 */

import { USLM_ELEMENTS } from './constants.js';

/**
 * Recursively walk nodes and concatenate all #text values in document order.
 * Preserves inline text boundaries and separates block elements.
 *
 * Security: the parser decodes XML entities, so `&lt;img&gt;` in the source
 * arrives here as the literal characters `<img>`. This text is later written
 * into Markdown that the web app renders without HTML sanitization, so any raw
 * `<`/`>` would be interpreted as live HTML (stored-XSS surface — see #200/H2).
 * We escape `<` and `>` to their entities here, at the single choke point all
 * rendered statute text flows through, so the generated Markdown is provably
 * HTML-free regardless of the upstream USLM content. Markers, headings and
 * title numbers are alphanumeric and unaffected; section paths derive from
 * element identifiers, not this text.
 */
export function extractTextFromNodes(nodes: unknown[]): string {
  return collectSourceText(nodes)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const TEXT_BLOCKS = new Set([
  'p', 'heading', 'num', 'content', 'chapeau', 'continuation', 'note',
  'section', 'subsection', 'paragraph', 'subparagraph', 'clause', 'subclause',
  'sourceCredit', 'table', 'tr', 'td', 'th', 'caption',
]);

function collectSourceText(nodes: unknown[]): string {
  const segments: string[] = [];
  for (const node of nodes) {
    if (!isObject(node)) continue;
    const obj = node as Record<string, unknown>;
    if ('#text' in obj) {
      segments.push(String(obj['#text']));
    } else {
      for (const [key, val] of Object.entries(obj)) {
        if (key === ':@') continue;
        if (Array.isArray(val)) {
          const text = collectSourceText(val);
          segments.push(TEXT_BLOCKS.has(key) ? ` ${text} ` : text);
        }
      }
    }
  }
  return segments.join('');
}

/**
 * Find all child elements with a given tag name.
 * Returns the child arrays (the value of the tag key) wrapped with their attributes.
 */
export function findElements(
  nodes: unknown[],
  tagName: string
): Array<{ children: unknown[]; attrs: Record<string, string> }> {
  const results: Array<{ children: unknown[]; attrs: Record<string, string> }> = [];
  for (const node of nodes) {
    if (!isObject(node)) continue;
    const obj = node as Record<string, unknown>;
    if (tagName in obj && Array.isArray(obj[tagName])) {
      const attrs = getAttributes(node);
      results.push({ children: obj[tagName] as unknown[], attrs });
    }
  }
  return results;
}

/**
 * Extract ":@" attributes from a preserveOrder node.
 * Returns an empty record if none present.
 */
export function getAttributes(node: unknown): Record<string, string> {
  if (!isObject(node)) return {};
  const obj = node as Record<string, unknown>;
  if (':@' in obj && isObject(obj[':@'])) {
    const raw = obj[':@'] as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      result[k] = String(v);
    }
    return result;
  }
  return {};
}

/**
 * Get the element tag name of a node (the first key that is not ":@" or "#text").
 * Returns null for text nodes or unrecognized shapes.
 */
export function getElementName(node: unknown): string | null {
  if (!isObject(node)) return null;
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== ':@' && key !== '#text') return key;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Extract heading text from node children */
export function extractHeading(children: unknown[]): string {
  const headings = findElements(children, USLM_ELEMENTS.heading);
  const first = headings[0];
  if (!first) return '';
  return extractTextFromNodes(first.children).trim();
}


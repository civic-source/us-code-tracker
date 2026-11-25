import { buildGovInfoPublicLawUrl, buildGovInfoStatuteUrl } from '@civic-source/shared';
import type { StructuredNote, StructuredTable } from '@civic-source/types';
import { USLM_ELEMENTS, MAX_NESTING_DEPTH } from './constants.js';
import { extractTextFromNodes, findElements, getAttributes, getElementName, extractHeading } from './xml-utils.js';

/** Format source credit nodes into markdown with GovInfo statutory citations */
export function formatSourceCredit(children: unknown[]): string {
  const parts: string[] = [];
  function walk(nodes: unknown[]): void {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const obj = node as Record<string, unknown>;
      if ('#text' in obj) {
        parts.push(String(obj['#text']));
      } else if (USLM_ELEMENTS.ref in obj && Array.isArray(obj[USLM_ELEMENTS.ref])) {
        const attrs = getAttributes(node);
        const href = attrs['@_href'] || attrs['href'] || '';
        const refText = extractTextFromNodes(obj[USLM_ELEMENTS.ref] as unknown[]).trim();
        const label = refText.replace(/([\\[\]])/g, '\\$1');
        const statMatch = /^\/us\/stat\/(\d+)\/(\d+)/.exec(href);
        const plMatch = /^\/us\/pl\/(\d+)\/(\d+)/.exec(href);
        if (statMatch?.[1] && statMatch[2]) {
          parts.push(`[${label}](${buildGovInfoStatuteUrl(statMatch[1], statMatch[2])})`);
        } else if (plMatch?.[1] && plMatch[2]) {
          parts.push(`[${label}](${buildGovInfoPublicLawUrl(plMatch[1], plMatch[2])})`);
        } else {
          parts.push(refText);
        }
      } else {
        for (const [k, v] of Object.entries(obj)) {
          if (k !== ':@' && Array.isArray(v)) {
            walk(v);
          }
        }
      }
    }
  }
  walk(children);

  const cleaned = parts
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+([,.;:)])/g, '$1')
    .trim();

  if (!cleaned) return '';
  if (cleaned.startsWith('*') && cleaned.endsWith('*')) {
    return cleaned;
  }
  return `*${cleaned}*`;
}

/** Classify a USLM <note> element role from its topic/role attributes and heading (USCT-010) */
export function classifyNoteRole(
  topic: string,
  heading: string,
  text: string
): StructuredNote['role'] {
  const combined = `${topic} ${heading} ${text}`.toLowerCase();
  if (combined.includes('effective date') || topic.includes('effectivedate')) return 'effective_date';
  if (combined.includes('transfer') || topic.includes('transfer')) return 'transfer';
  if (combined.includes('repeal') || topic.includes('repeal')) return 'repeal';
  if (combined.includes('amendment') || topic.includes('amendment')) return 'amendment';
  if (combined.includes('codification') || topic.includes('codification')) return 'codification';
  if (combined.includes('cross reference') || topic.includes('crossreference')) return 'cross_reference';
  return 'general';
}

/** Collect notes in wrapper order, retaining each enclosing note exactly once. */
export function findNoteElements(nodes: unknown[], depth = 0): ReturnType<typeof findElements> {
  if (depth > MAX_NESTING_DEPTH) return [];
  const notes: ReturnType<typeof findElements> = [];
  for (const node of nodes) {
    const tag = getElementName(node);
    if (!tag || !node || typeof node !== 'object') continue;
    const children = (node as Record<string, unknown>)[tag];
    if (!Array.isArray(children)) continue;
    if (tag === USLM_ELEMENTS.note) notes.push({ children, attrs: getAttributes(node) });
    else notes.push(...findNoteElements(children, depth + 1));
  }
  return notes;
}

/** Extract structured statutory notes from a section and its wrappers. */
export function extractStructuredNotes(
  sectionChildren: unknown[],
  baseLocator = '/section'
): StructuredNote[] {
  const notes = findNoteElements(sectionChildren);
  const results: StructuredNote[] = [];

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (!note) continue;
    const heading = extractHeading(note.children);
    const text = extractTextFromNodes(note.children).trim();
    if (!text) continue;

    const topic = note.attrs['@_topic'] || note.attrs['@_role'] || '';
    const identifier = note.attrs['@_identifier'] || '';

    const locator = identifier || `${baseLocator}/note[${i + 1}]`;
    const role = classifyNoteRole(topic, heading, text);
    results.push({
      noteId: `note-${i + 1}`,
      ...(topic ? { topic } : {}),
      role,
      ...(heading ? { heading } : {}),
      text,
      locator,
    });
  }
  return results;
}

/** Extract structured tables recursively and render GFM table markdown (USCT-010) */
export function extractStructuredTables(
  nodes: unknown[],
  baseLocator = '/section'
): StructuredTable[] {
  const tables: StructuredTable[] = [];

  function walkForTables(children: unknown[], pathPrefix: string): void {
    for (let idx = 0; idx < children.length; idx++) {
      const node = children[idx];
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
      const tag = getElementName(node);
      if (!tag) continue;
      const obj = node as Record<string, unknown>;
      const elemChildren = Array.isArray(obj[tag]) ? (obj[tag] as unknown[]) : [];

      if (tag === USLM_ELEMENTS.table) {
        const attrs = getAttributes(node);
        const locator = attrs['@_identifier'] || `${pathPrefix}/table[${tables.length + 1}]`;
        const captionEl = findElements(elemChildren, USLM_ELEMENTS.caption)[0]
          ?? findElements(elemChildren, USLM_ELEMENTS.heading)[0];
        const caption = captionEl ? extractTextFromNodes(captionEl.children).trim() : undefined;

        const headers: string[] = [];
        const rows: string[][] = [];

        const thead = findElements(elemChildren, USLM_ELEMENTS.thead)[0];
        if (thead) {
          const headerRows = findElements(thead.children, USLM_ELEMENTS.tr);
          const firstRow = headerRows[0];
          if (firstRow) {
            const ths = findElements(firstRow.children, USLM_ELEMENTS.th);
            const tds = ths.length > 0 ? ths : findElements(firstRow.children, USLM_ELEMENTS.td);
            for (const cell of tds) {
              headers.push(extractTextFromNodes(cell.children).trim());
            }
          }
        }

        const tbody = findElements(elemChildren, USLM_ELEMENTS.tbody)[0];
        const rowContainers = tbody ? [tbody.children] : [elemChildren];
        for (const container of rowContainers) {
          const trs = findElements(container, USLM_ELEMENTS.tr);
          for (const tr of trs) {
            const ths = findElements(tr.children, USLM_ELEMENTS.th);
            const tds = findElements(tr.children, USLM_ELEMENTS.td);
            if (!thead && headers.length === 0 && ths.length > 0) {
              for (const th of ths) headers.push(extractTextFromNodes(th.children).trim());
              continue;
            }
            const cells = tds.length > 0 ? tds : ths;
            if (cells.length > 0) {
              rows.push(cells.map((c) => extractTextFromNodes(c.children).trim()));
            }
          }
        }

        if (headers.length === 0 && rows.length > 0 && rows[0]) {
          headers.push(...rows[0].map((_, cIdx) => `Column ${cIdx + 1}`));
        }

        tables.push({
          tableId: `table-${tables.length + 1}`,
          ...(caption ? { caption } : {}),
          headers,
          rows,
          locator,
        });
      } else {
        walkForTables(elemChildren, `${pathPrefix}/${tag}`);
      }
    }
  }

  walkForTables(nodes, baseLocator);
  return tables;
}

/** Render a StructuredTable to GitHub Flavored Markdown (USCT-010) */
export function formatTableMarkdown(table: StructuredTable): string {
  const lines: string[] = [];
  if (table.caption) {
    lines.push(`**${table.caption}**`);
    lines.push('');
  }
  const colCount = Math.max(
    table.headers.length,
    ...table.rows.map((r) => r.length),
    1
  );
  const escapeCell = (s: string) =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, ' ')
      .trim();
  const hdrs = Array.from({ length: colCount }, (_, i) => escapeCell(table.headers[i] ?? `Col ${i + 1}`));
  lines.push(`| ${hdrs.join(' | ')} |`);
  lines.push(`| ${hdrs.map(() => '---').join(' | ')} |`);
  for (const row of table.rows) {
    const cells = Array.from({ length: colCount }, (_, i) => escapeCell(row[i] ?? ''));
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

const KNOWN_SECTION_TAGS: ReadonlySet<string> = new Set([
  ...Object.values(USLM_ELEMENTS),
  'notes',
  'editorialNote',
  'statutoryNote',
  'changeNote',
  'continuation',
  'proviso',
  'def',
  'term',
  'date',
  'quotedContent',
  'p',
  'inline',
  'i',
  'b',
  'sup',
  'sub',
  'layout',
  'column',
  'header',
  'toc',
  'tocItem',
]);

/** Detect unsupported USLM structures inside a section and produce faithful text fallbacks (USCT-010) */
export function detectUnsupportedStructures(
  sectionChildren: unknown[],
  baseLocator = '/section'
): Array<{ elementName: string; locator: string; fallbackText: string; reason: string }> {
  const findings: Array<{ elementName: string; locator: string; fallbackText: string; reason: string }> = [];

  function walk(nodes: unknown[], prefix: string): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
      const tag = getElementName(node);
      if (!tag) continue;
      const obj = node as Record<string, unknown>;
      const children = Array.isArray(obj[tag]) ? (obj[tag] as unknown[]) : [];
      const locator = `${prefix}/${tag}[${i + 1}]`;

      if (!KNOWN_SECTION_TAGS.has(tag)) {
        const fallbackText = extractTextFromNodes(children).trim();
        findings.push({
          elementName: tag,
          locator,
          fallbackText,
          reason: `Unrecognized USLM element <${tag}> preserved via plain-text fallback`,
        });
      } else {
        walk(children, locator);
      }
    }
  }

  walk(sectionChildren, baseLocator);
  return findings;
}


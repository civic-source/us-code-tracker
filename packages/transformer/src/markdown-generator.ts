import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { StructuredNote, StructuredTable } from '@civic-source/types';
import { USLM_ELEMENTS, INDENT_PER_LEVEL, MAX_NESTING_DEPTH } from './constants.js';
import { extractTextFromNodes, findElements, getAttributes, getElementName } from './xml-utils.js';

/** Section status — derived from heading text during transformation */
export const SectionStatusSchema = z.enum([
  'active', 'repealed', 'reserved', 'omitted', 'transferred', 'renumbered',
]);

export type SectionStatus = z.infer<typeof SectionStatusSchema>;

/** Zod schema for YAML frontmatter validation */
export const FrontmatterSchema = z.object({
  title: z.string().min(1),
  usc_title: z.union([z.string().min(1), z.number().int().positive()]).transform((val) => String(val)),
  usc_section: z.string().min(1),
  chapter: z.number().int().nonnegative(),
  current_through: z.string().default('Unknown'),
  classification: z.string().min(1),
  generated_at: z.string().min(1),
  status: SectionStatusSchema.default('active'),
});

export type Frontmatter = z.infer<typeof FrontmatterSchema>;

/** Detect section status from heading text */
export function detectSectionStatus(heading: string): SectionStatus {
  if (heading.includes('Repealed')) return 'repealed';
  if (heading.includes('Reserved')) return 'reserved';
  if (heading.includes('Omitted')) return 'omitted';
  if (heading.includes('Renumbered')) return 'renumbered';
  if (heading.includes('Transferred') && !heading.includes('Transferred or reemployed')) return 'transferred';
  return 'active';
}

/** A generated markdown file with its path, content, and USCT-010 rich structural extraction */
export interface MarkdownFile {
  /** Relative path: statutes/title-{n}/chapter-{n}/section-{n}.md */
  path: string;
  /** Full markdown content including frontmatter */
  content: string;
  /** Deterministic SHA-256 of normalized statutory text + structure (independent of timestamps/rendering) */
  normalizedContentHash?: string;
  /** Extracted USLM @identifier attribute (e.g. "/us/usc/t18/s111") */
  uslmIdentifier?: string;
  /** Extracted structured statutory notes (amendment, effective_date, transfer, repeal, general) */
  notes?: StructuredNote[];
  /** Extracted structured tables */
  tables?: StructuredTable[];
  /** Extracted source credits */
  sourceCredits?: string[];
  /** Unsupported USLM structures encountered with faithful text fallbacks */
  unsupportedStructures?: Array<{
    elementName: string;
    locator: string;
    fallbackText: string;
    reason: string;
  }>;
}

/**
 * Pattern to detect inline legal list markers like (a), (b), (1), (A), (i), (ii).
 * Matches when preceded by whitespace (or start of string).
 * Groups: full match includes leading space; capture group 1 is the marker itself.
 */
const INLINE_MARKER_PATTERN =
  /(?<=\s)(\([a-z]\)|\(\d{1,2}\)|\([A-Z]\)|\([ivxlcdm]+\))\s/g;

/**
 * Determine indentation depth for an inline marker based on its type.
 * - (a)-(z) lowercase alpha → depth 0
 * - (1)-(99) numeric → depth 1
 * - (A)-(Z) uppercase alpha → depth 2
 * - (i)-(xx) lowercase roman → depth 3
 */
function markerDepth(marker: string): number {
  const inner = marker.slice(1, -1); // strip parens
  if (/^\d{1,2}$/.test(inner)) return 1;     // (1)-(99)
  if (/^[A-Z]$/.test(inner)) return 2;       // (A)-(Z)
  // Multi-char roman numerals are unambiguous: (ii), (iii), (iv), (vi), etc.
  // Single-char (i), (v), (x) are treated as roman per legal convention
  // (legal alpha lists rarely reach these letters before switching to roman)
  if (/^[ivxlcdm]{2,}$/.test(inner)) return 3;  // (ii), (iii), (iv), etc.
  if (/^[ivx]$/.test(inner)) return 3;           // (i), (v), (x) — roman
  if (/^[a-z]$/.test(inner)) return 0;           // (a)-(h), (j)-(z)
  return 0;
}

/**
 * Reformat inline legal list markers into proper markdown list items.
 *
 * Detects lines containing multiple inline markers like:
 *   "(a) Definitions In this section— ... (b) First offense ..."
 * and splits them into separate markdown list items with correct indentation.
 *
 * Only processes lines that don't already contain `- **` markers.
 */
export function reformatInlineLists(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    // Skip lines already formatted as markdown list items
    if (/^\s*- \*\*/.test(line)) {
      result.push(line);
      continue;
    }

    // Skip headings and empty lines
    if (line.startsWith('#') || line.trim() === '') {
      result.push(line);
      continue;
    }

    // Collect all marker positions: { offset, fullMatch, marker }
    const markers: Array<{ offset: number; fullLength: number; marker: string }> = [];

    // Check for marker at start of string (no preceding whitespace)
    const startMatch = line.match(/^(\([a-z]\)|\(\d{1,2}\)|\([A-Z]\)|\([ivxlcdm]+\))\s/);
    if (startMatch) {
      markers.push({ offset: 0, fullLength: startMatch[0].length, marker: startMatch[1] ?? '' });
    }

    // Collect inline markers preceded by whitespace
    INLINE_MARKER_PATTERN.lastIndex = 0;
    let inlineMatch: RegExpExecArray | null;
    while ((inlineMatch = INLINE_MARKER_PATTERN.exec(line)) !== null) {
      markers.push({
        offset: inlineMatch.index,
        fullLength: inlineMatch[0].length,
        marker: inlineMatch[1] ?? '',
      });
    }

    if (markers.length < 2) {
      result.push(line);
      continue;
    }

    // Split line at each marker position
    for (let idx = 0; idx < markers.length; idx++) {
      const entry = markers[idx];
      if (!entry) continue;

      const depth = markerDepth(entry.marker);
      const indent = ' '.repeat(depth * INDENT_PER_LEVEL);

      // Text runs from after this marker to the start of the next marker (or end of line)
      const textStart = entry.offset + entry.fullLength;
      const nextEntry = markers[idx + 1];
      const textEnd = nextEntry !== undefined ? nextEntry.offset : line.length;
      const itemText = line.slice(textStart, textEnd).trim();

      result.push(`${indent}- **${entry.marker}** ${itemText}`);
    }
  }

  return result.join('\n');
}

/** Build the output file path for a section */
export function buildSectionPath(titleNum: string, chapterNum: string, sectionNum: string): string {
  return `statutes/title-${titleNum}/chapter-${chapterNum}/section-${sectionNum}.md`;
}

/**
 * Serialize a string as a YAML double-quoted scalar.
 *
 * Statute headings carry untrusted OLRC content (e.g. defined terms quoted as
 * `"employee"`); interpolating them raw into `title: "..."` produces invalid
 * YAML and is a frontmatter-injection vector. Escape per the YAML double-quoted
 * rules: backslash first, then the quote, then the whitespace control chars
 * that `extractTextFromNodes` collapses but public callers may still pass.
 */
function yamlQuote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // Remaining C0/DEL control chars are invalid raw inside a YAML
    // double-quoted scalar; emit \uXXXX so the scalar stays parseable.
    // eslint-disable-next-line no-control-regex -- intentionally matching control chars to escape them
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) =>
      `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
    );
  return `"${escaped}"`;
}

/** Generate YAML frontmatter string from validated data */
export function generateFrontmatter(data: {
  title: string;
  usc_title: string | number;
  usc_section: string;
  chapter: number;
  current_through: string;
  classification: string;
  generated_at: string;
  status: SectionStatus;
}): string {
  const titleStr = String(data.usc_title);
  const formattedTitle = /^\d+$/.test(titleStr) ? titleStr : yamlQuote(titleStr);
  const lines = [
    '---',
    `title: ${yamlQuote(data.title)}`,
    `usc_title: ${formattedTitle}`,
    `usc_section: ${yamlQuote(data.usc_section)}`,
    `chapter: ${data.chapter}`,
    `current_through: ${yamlQuote(data.current_through)}`,
    `classification: ${yamlQuote(data.classification)}`,
    `generated_at: ${yamlQuote(data.generated_at)}`,
    `status: ${yamlQuote(data.status)}`,
    '---',
    '',
  ];
  return lines.join('\n');
}

/** Format a legal list item as a markdown unordered list entry with bold marker */
export function formatListItem(marker: string, text: string, depth: number): string {
  const indent = ' '.repeat(Math.min(depth, MAX_NESTING_DEPTH) * INDENT_PER_LEVEL);
  const boldMarker = marker ? `**${marker}**` : '';
  return `${indent}- ${boldMarker}${text ? ' ' + text : ''}`;
}

/**
 * Determine nesting depth for a USLM element type.
 * subsection=0, paragraph=1, subparagraph=2, clause=3, subclause=4
 */
export function nestingDepthFor(elementName: string): number {
  const depthMap: Record<string, number> = {
    [USLM_ELEMENTS.subsection]: 0,
    [USLM_ELEMENTS.paragraph]: 1,
    [USLM_ELEMENTS.subparagraph]: 2,
    [USLM_ELEMENTS.clause]: 3,
    [USLM_ELEMENTS.subclause]: 4,
  };
  return depthMap[elementName] ?? 0;
}

/** Extract marker text like "(a)" from a num element within node children */
function extractMarker(children: unknown[]): string {
  const nums = findElements(children, USLM_ELEMENTS.num);
  const first = nums[0];
  if (!first) return '';
  return extractTextFromNodes(first.children).trim();
}

/** Extract heading text from node children */
function extractHeading(children: unknown[]): string {
  const headings = findElements(children, USLM_ELEMENTS.heading);
  const first = headings[0];
  if (!first) return '';
  return extractTextFromNodes(first.children).trim();
}

/** Extract content/chapeau text from node children */
function extractContent(children: unknown[]): string {
  const firstChapeau = findElements(children, USLM_ELEMENTS.chapeau)[0];
  if (firstChapeau) {
    return extractTextFromNodes(firstChapeau.children).trim();
  }
  const firstContent = findElements(children, USLM_ELEMENTS.content)[0];
  if (firstContent) {
    return extractTextFromNodes(firstContent.children).trim();
  }
  return '';
}

/** Recursively walk nested list elements and generate markdown lines */
function walkListElements(
  children: unknown[],
  depth: number,
  lines: string[]
): void {
  if (depth > MAX_NESTING_DEPTH) return;

  const listElements = [
    USLM_ELEMENTS.subsection,
    USLM_ELEMENTS.paragraph,
    USLM_ELEMENTS.subparagraph,
    USLM_ELEMENTS.clause,
    USLM_ELEMENTS.subclause,
  ];

  for (const elemName of listElements) {
    const items = findElements(children, elemName);
    for (const item of items) {
      const marker = extractMarker(item.children);
      const text = extractContent(item.children);
      const childDepth = nestingDepthFor(elemName);

      if (marker || text) {
        lines.push(formatListItem(marker, text, childDepth));
      }
      walkListElements(item.children, depth + 1, lines);
    }
  }
}

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
        const statMatch = /^\/us\/stat\/(\d+)\/(\d+)/.exec(href);
        const plMatch = /^\/us\/pl\/(\d+)\/(\d+)/.exec(href);
        if (statMatch) {
          parts.push(`[${refText}](https://www.govinfo.gov/link/statute/${statMatch[1]}/${statMatch[2]})`);
        } else if (plMatch) {
          parts.push(`[${refText}](https://www.govinfo.gov/link/plaw/${plMatch[1]}/public/${plMatch[2]})`);
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
    .join(' ')
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

/** Extract structured statutory notes from a section's children (USCT-010) */
export function extractStructuredNotes(
  sectionChildren: unknown[],
  baseLocator = '/section'
): StructuredNote[] {
  const notes = findElements(sectionChildren, USLM_ELEMENTS.note);
  const results: StructuredNote[] = [];

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (!note) continue;
    const heading = extractHeading(note.children);
    const text = extractTextFromNodes(note.children).trim();
    if (!text) continue;

    // Look for attributes on the raw preserveOrder node
    let topic = '';
    let identifier = '';
    for (const rawNode of sectionChildren) {
      if (rawNode && typeof rawNode === 'object' && USLM_ELEMENTS.note in (rawNode as Record<string, unknown>)) {
        const attrs = getAttributes(rawNode);
        if ((rawNode as Record<string, unknown>)[USLM_ELEMENTS.note] === note.children) {
          topic = attrs['@_topic'] || attrs['@_role'] || '';
          identifier = attrs['@_identifier'] || '';
        }
      }
    }

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

/** Generate markdown body for a single section node (preserveOrder children) */
export function generateSectionBody(sectionChildren: unknown[]): string {
  const lines: string[] = [];

  // Section heading
  const heading = extractHeading(sectionChildren);
  const sectionNum = extractMarker(sectionChildren);
  if (heading) {
    lines.push(`# ${sectionNum ? sectionNum + ' ' : ''}${heading}`);
    lines.push('');
  }

  // Direct content under section (USLM 1.0 sections may have <content> without subsections)
  const directContent = extractContent(sectionChildren);
  if (directContent) {
    lines.push(directContent);
    lines.push('');
  }

  // Walk nested list elements
  walkListElements(sectionChildren, 0, lines);

  // Tables (USCT-010)
  const tables = extractStructuredTables(sectionChildren);
  if (tables.length > 0) {
    lines.push('');
    for (const tbl of tables) {
      lines.push(formatTableMarkdown(tbl));
      lines.push('');
    }
  }

  // Unsupported structure fallbacks so zero legal text is silently dropped (USCT-010)
  const unsupported = detectUnsupportedStructures(sectionChildren);
  for (const u of unsupported) {
    if (u.fallbackText) {
      lines.push('');
      lines.push(u.fallbackText);
    }
  }

  // Source credit / legislative history
  const sourceCredits = findElements(sectionChildren, USLM_ELEMENTS.sourceCredit);
  if (sourceCredits.length > 0) {
    lines.push('');
    lines.push('## Source Credit');
    lines.push('');
    for (const sc of sourceCredits) {
      const credit = formatSourceCredit(sc.children);
      if (credit) lines.push(credit);
    }
  }

  // Notes
  const notes = findElements(sectionChildren, USLM_ELEMENTS.note);
  if (notes.length > 0) {
    lines.push('');
    lines.push('## Notes');
    lines.push('');
    for (const note of notes) {
      const text = extractTextFromNodes(note.children).trim();
      if (text) lines.push(text);
    }
  }

  return lines.join('\n');
}

/**
 * Generate a complete markdown file for a section.
 * sectionChildren is the children array of the section element in preserveOrder format.
 * Returns the MarkdownFile with path and content.
 */
export function generateMarkdownForSection(
  sectionChildren: unknown[],
  titleNum: string,
  chapterNum: string,
  sectionNum: string,
  currentThrough: string,
  uslmIdentifier?: string
): MarkdownFile {
  const heading = extractHeading(sectionChildren);
  const now = new Date().toISOString();

  const chapterInt = parseInt(chapterNum, 10) || 0;

  const sectionTitle = `Section ${sectionNum}${heading ? ' - ' + heading : ''}`;
  const status = detectSectionStatus(sectionTitle);
  const frontmatter = FrontmatterSchema.parse({
    title: sectionTitle,
    usc_title: String(titleNum).trim() || '1',
    usc_section: sectionNum,
    chapter: chapterInt,
    current_through: currentThrough || 'Unknown',
    classification: `${titleNum} U.S.C. \u00A7 ${sectionNum}`,
    generated_at: now,
    status,
  });

  let body = generateSectionBody(sectionChildren);

  // Post-process: reformat inline list markers if body isn't already formatted
  if (!body.includes('- **')) {
    body = reformatInlineLists(body);
  }

  const baseLocator = uslmIdentifier ?? `/us/usc/t${titleNum}/s${sectionNum}`;
  const notes = extractStructuredNotes(sectionChildren, baseLocator);
  const tables = extractStructuredTables(sectionChildren, baseLocator);
  const unsupportedStructures = detectUnsupportedStructures(sectionChildren, baseLocator);
  const sourceCredits = findElements(sectionChildren, USLM_ELEMENTS.sourceCredit)
    .map((sc) => formatSourceCredit(sc.children))
    .filter(Boolean);

  // Deterministic content hash excludes generated_at and current_through so changing only
  // retrieval/generation timestamps or release labels never invents a new legal text version (USCT-008)
  const normalizedContentHash = createHash('sha256')
    .update(`usct-norm:v1:${titleNum}:${sectionNum}:${status}:${heading}\n${body.trim()}`)
    .digest('hex');

  const content = generateFrontmatter(frontmatter) + '\n' + body + '\n';
  const path = buildSectionPath(titleNum, chapterNum, sectionNum);

  return {
    path,
    content,
    normalizedContentHash,
    uslmIdentifier: baseLocator,
    notes,
    tables,
    sourceCredits,
    unsupportedStructures,
  };
}

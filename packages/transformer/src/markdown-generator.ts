import { createHash } from 'node:crypto';
import type { StructuredNote, StructuredTable } from '@civic-source/types';
import { USLM_ELEMENTS, INDENT_PER_LEVEL, MAX_NESTING_DEPTH } from './constants.js';
import { extractTextFromNodes, findElements, getElementName, extractHeading } from './xml-utils.js';
import {
  FrontmatterSchema, detectSectionStatus, generateFrontmatter, buildSectionPath,
  formatListItem, nestingDepthFor,
} from './markdown-format.js';
import {
  extractStructuredNotes, extractStructuredTables, formatTableMarkdown,
  detectUnsupportedStructures, formatSourceCredit, findNoteElements,
} from './rich-structure.js';

export {
  SectionStatusSchema, FrontmatterSchema, detectSectionStatus, generateFrontmatter,
  buildSectionPath, formatListItem, nestingDepthFor, reformatInlineLists,
} from './markdown-format.js';
export type { SectionStatus, Frontmatter } from './markdown-format.js';
export {
  formatSourceCredit, classifyNoteRole, extractStructuredNotes,
  extractStructuredTables, formatTableMarkdown, detectUnsupportedStructures,
} from './rich-structure.js';

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

/** Extract marker text like "(a)" from a num element within node children */
function extractMarker(children: unknown[]): string {
  const nums = findElements(children, USLM_ELEMENTS.num);
  const first = nums[0];
  if (!first) return '';
  return extractTextFromNodes(first.children).trim();
}

function withoutTables(nodes: unknown[]): unknown[] {
  return nodes.filter((n) => getElementName(n) !== USLM_ELEMENTS.table);
}

/** Extract content/chapeau text from node children (excluding embedded table elements rendered as GFM tables) */
function extractContent(children: unknown[]): string {
  const firstChapeau = findElements(children, USLM_ELEMENTS.chapeau)[0];
  if (firstChapeau) {
    return extractTextFromNodes(withoutTables(firstChapeau.children)).trim();
  }
  const firstContent = findElements(children, USLM_ELEMENTS.content)[0];
  if (firstContent) {
    return extractTextFromNodes(withoutTables(firstContent.children)).trim();
  }
  return '';
}

const LIST_ELEMENT_SET: ReadonlySet<string> = new Set([
  USLM_ELEMENTS.subsection,
  USLM_ELEMENTS.paragraph,
  USLM_ELEMENTS.subparagraph,
  USLM_ELEMENTS.clause,
  USLM_ELEMENTS.subclause,
]);

/** Extract tables attached directly inside a node's immediate chapeau/content element */
function extractContentChapeauTables(itemChildren: unknown[], pathPrefix: string): StructuredTable[] {
  const directTableNodes: unknown[] = [];
  for (const child of itemChildren) {
    const tag = getElementName(child);
    if (tag === USLM_ELEMENTS.content || tag === USLM_ELEMENTS.chapeau) {
      const inner = (child as Record<string, unknown>)[tag];
      if (Array.isArray(inner)) {
        for (const grandChild of inner) {
          if (getElementName(grandChild) === USLM_ELEMENTS.table) {
            directTableNodes.push(grandChild);
          }
        }
      }
    }
  }
  return directTableNodes.length > 0 ? extractStructuredTables(directTableNodes, pathPrefix) : [];
}

/** Recursively walk nested list elements and in-place tables in exact document order */
function walkListElements(
  children: unknown[],
  depth: number,
  lines: string[],
  emittedTableFingerprints?: Set<string>
): void {
  if (depth > MAX_NESTING_DEPTH) return;

  for (const rawNode of children) {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) continue;
    const elemName = getElementName(rawNode);
    if (!elemName) continue;

    if (elemName === 'continuation') {
      const children = (rawNode as Record<string, unknown>)[elemName];
      if (Array.isArray(children)) {
        const text = extractTextFromNodes(children);
        if (text) lines.push('', `${' '.repeat(depth * INDENT_PER_LEVEL)}${text}`, '');
      }
      continue;
    }

    if (elemName === USLM_ELEMENTS.table) {
      const inlineTables = extractStructuredTables([rawNode], `/depth-${depth}`);
      for (const tbl of inlineTables) {
        const fp = JSON.stringify([tbl.caption, tbl.headers, tbl.rows]);
        emittedTableFingerprints?.add(fp);
        lines.push('');
        lines.push(formatTableMarkdown(tbl));
        lines.push('');
      }
      continue;
    }

    if (!LIST_ELEMENT_SET.has(elemName)) continue;
    const itemChildren = Array.isArray((rawNode as Record<string, unknown>)[elemName])
      ? ((rawNode as Record<string, unknown>)[elemName] as unknown[])
      : [];

    const marker = extractMarker(itemChildren);
    const text = [extractHeading(itemChildren), extractContent(itemChildren)].filter(Boolean).join(' ');
    const childDepth = nestingDepthFor(elemName);

    if (marker || text) {
      lines.push(formatListItem(marker, text, childDepth));
    }

    const chapeauTables = extractContentChapeauTables(itemChildren, `/section/${elemName}`);
    for (const tbl of chapeauTables) {
      const fp = JSON.stringify([tbl.caption, tbl.headers, tbl.rows]);
      emittedTableFingerprints?.add(fp);
      lines.push('');
      lines.push(formatTableMarkdown(tbl));
      lines.push('');
    }

    walkListElements(itemChildren, depth + 1, lines, emittedTableFingerprints);
  }
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

  // Walk nested list elements and in-place tables in document order
  const emittedTableFingerprints = new Set<string>();
  walkListElements(sectionChildren, 0, lines, emittedTableFingerprints);

  // Any remaining tables not already emitted in-place (USCT-010)
  const tables = extractStructuredTables(sectionChildren).filter(
    (tbl) => !emittedTableFingerprints.has(JSON.stringify([tbl.caption, tbl.headers, tbl.rows]))
  );
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
  const notes = findNoteElements(sectionChildren);
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

  const body = generateSectionBody(sectionChildren);

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

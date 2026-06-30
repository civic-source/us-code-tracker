import { type PrecedentAnnotation, PrecedentAnnotationSchema, type Result, ok, err } from '@civic-source/types';
import { type Logger, createLogger } from '@civic-source/shared';
import { type CourtListenerResult, CourtListenerClient } from './client.js';
import {
  COURTLISTENER_BASE_URL,
  COURT_PRIORITY,
  MAX_HOLDING_SUMMARY_LENGTH,
  MAX_CASE_NAME_LENGTH,
  MAX_CITATION_LENGTH,
  getApiToken,
} from './constants.js';
import { deduplicateCases } from './citation-utils.js';

/** Result of annotating a section, including the output path */
export interface AnnotationResult {
  annotation: PrecedentAnnotation;
  /** Relative output path: annotations/title-{n}/chapter-{n}/section-{n}.yaml */
  path: string;
}

type CourtType = 'SCOTUS' | 'Appellate' | 'District';

/** Map a CourtListener court ID to the schema court enum */
export function mapCourt(courtId: string): CourtType {
  const id = courtId.toLowerCase();
  if (id === 'scotus') return 'SCOTUS';
  // Federal appellate courts: ca1-ca11, cadc, cafc
  if (/^ca\d{1,2}$/.test(id) || id === 'cadc' || id === 'cafc') return 'Appellate';
  // Everything else is treated as District
  return 'District';
}

/** Sort results by court priority (SCOTUS first, then Appellate, then District) */
function sortByCourtPriority(results: CourtListenerResult[]): CourtListenerResult[] {
  return [...results].sort((a, b) => {
    const aPriority = COURT_PRIORITY[mapCourt(a.court)] ?? 2;
    const bPriority = COURT_PRIORITY[mapCourt(b.court)] ?? 2;
    return aPriority - bPriority;
  });
}

/**
 * Truncate an untrusted string to at most `max` UTF-16 code units, bounding the
 * values that flow into the hand-rolled YAML sidecar (#232). `max` is measured
 * in code units (matching the schema's `.max()` checks). When truncation splits
 * a surrogate pair, the trailing lone high surrogate is dropped so the result
 * never ends in a broken character.
 */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max - 3; // reserve room for the ellipsis
  const lastKept = value.charCodeAt(end - 1);
  if (lastKept >= 0xd800 && lastKept <= 0xdbff) end -= 1; // don't split a surrogate pair
  return value.slice(0, end) + '...';
}

/** Origin of the CourtListener site — a sourceUrl must resolve to this host. */
const COURTLISTENER_ORIGIN = new URL(COURTLISTENER_BASE_URL).origin;

/**
 * Resolve an untrusted CourtListener `absolute_url` into a same-origin source URL.
 *
 * `absolute_url` is API data; string-concatenating it onto the base host lets a
 * poisoned value point the link off-site — `@evil.com/x` →
 * `https://www.courtlistener.com@evil.com/x` (authority `evil.com`),
 * `//evil.com/x`, or an outright `https://evil.com/x`. Resolving it as a
 * relative reference and pinning the origin neutralizes all three: anything
 * that does not resolve to the CourtListener origin collapses to `''` (an
 * empty, schema-valid sourceUrl that renders no off-site href).
 */
export function courtListenerSourceUrl(absoluteUrl: string): string {
  try {
    const resolved = new URL(absoluteUrl, `${COURTLISTENER_ORIGIN}/`);
    // Pin the origin AND reject userinfo: a same-origin URL can still carry an
    // attacker-controlled `user@` prefix (e.g.
    // `https://evil.example@www.courtlistener.com/...`) whose origin matches but
    // whose rendered href is misleading. Legitimate opinion paths never have it.
    if (
      resolved.origin !== COURTLISTENER_ORIGIN ||
      resolved.username !== '' ||
      resolved.password !== ''
    ) {
      return '';
    }
    return resolved.toString();
  } catch {
    return '';
  }
}

/**
 * Build the annotation output path from a section citation.
 * Input: "18 U.S.C. 111" -> "annotations/title-18/section-111.yaml"
 * Falls back to a sanitized slug when the citation doesn't match the expected pattern.
 */
export function buildAnnotationPath(section: string): string {
  const match = /^(\d+[a-zA-Z]?)\s+U\.S\.C\.\s+(\d+[a-zA-Z-]*)$/.exec(section);
  if (!match) {
    // Fallback: sanitize the section string into a safe filename
    const slug = section.replace(/[^a-zA-Z0-9-]/g, '_').toLowerCase();
    return `annotations/${slug}.yaml`;
  }
  const [, titleNum, sectionNum] = match;
  return `annotations/title-${titleNum}/section-${sectionNum}.yaml`;
}

/**
 * Escape a string for a YAML double-quoted scalar.
 *
 * Case fields (caseName, snippet/holdingSummary, dateFiled, absolute_url ->
 * sourceUrl) are untrusted CourtListener API data. Escape backslash first,
 * then the quote, then the whitespace/control chars that would otherwise
 * terminate or inject into the scalar — a `"` or newline in any field must not
 * be able to forge or corrupt sidecar keys.
 */
function yamlEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // eslint-disable-next-line no-control-regex -- intentionally matching control chars to escape them
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) =>
      `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
    );
}

/** Serialize a PrecedentAnnotation to simple YAML (no external deps) */
export function annotationToYaml(annotation: PrecedentAnnotation): string {
  const lines: string[] = [];
  lines.push(`targetSection: "${yamlEscape(annotation.targetSection)}"`);
  lines.push(`lastSyncedET: "${yamlEscape(annotation.lastSyncedET)}"`);
  lines.push('cases:');
  for (const c of annotation.cases) {
    lines.push(`  - caseName: "${yamlEscape(c.caseName)}"`);
    lines.push(`    citation: "${yamlEscape(c.citation)}"`);
    lines.push(`    court: "${yamlEscape(c.court)}"`);
    lines.push(`    date: "${yamlEscape(c.date)}"`);
    lines.push(`    holdingSummary: "${yamlEscape(c.holdingSummary)}"`);
    lines.push(`    sourceUrl: "${yamlEscape(c.sourceUrl)}"`);
    lines.push(`    impact: "${yamlEscape(c.impact)}"`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Annotate a US Code section with precedent cases from CourtListener.
 *
 * Coverage caveat: CourtListener does not index statute citations as structured
 * fields. This annotator uses full-text search (e.g., "18 U.S.C. 111"), so
 * results are approximate and may miss cases that cite the statute differently.
 */
export class Annotator {
  private readonly client: CourtListenerClient;
  private readonly logger: Logger;

  constructor(options?: { client?: CourtListenerClient; logger?: Logger }) {
    this.logger = options?.logger ?? createLogger('Annotator');
    this.client = options?.client ?? new CourtListenerClient({
      token: getApiToken(),
      logger: this.logger,
    });
  }

  /** Query CourtListener for a section and build a validated PrecedentAnnotation */
  async annotateSection(section: string): Promise<Result<AnnotationResult>> {
    const timer = this.logger.startTimer('annotateSection');
    this.logger.info('Annotating section', { section });

    // Rate limiting is enforced by the CourtListener client (the sole HTTP
    // choke point); a second bucket here was redundant double-limiting (#230).
    const searchResult = await this.client.searchByStatute(section);
    if (!searchResult.ok) {
      timer();
      return searchResult;
    }

    const sorted = sortByCourtPriority(searchResult.value);
    const isoNow = new Date().toISOString();

    const rawCases = sorted.map((result) => ({
      // Bound untrusted CourtListener strings to their schema caps so a long
      // value is clamped (not dropped by schema validation) and never bloats
      // the YAML sidecar (#232).
      caseName: truncate(result.caseName, MAX_CASE_NAME_LENGTH),
      citation: truncate(result.citation[0] ?? '', MAX_CITATION_LENGTH),
      court: mapCourt(result.court),
      date: result.dateFiled,
      holdingSummary: truncate(result.snippet, MAX_HOLDING_SUMMARY_LENGTH),
      sourceUrl: courtListenerSourceUrl(result.absolute_url),
      impact: 'interpretation' as const,
    }));

    const dedupedCases = deduplicateCases(rawCases);
    const duplicatesFound = rawCases.length - dedupedCases.length;

    const annotation: PrecedentAnnotation = {
      targetSection: section,
      lastSyncedET: isoNow,
      cases: dedupedCases,
    };

    const parsed = PrecedentAnnotationSchema.safeParse(annotation);
    if (!parsed.success) {
      timer();
      return err(new Error(`Schema validation failed: ${parsed.error.message}`));
    }

    const path = buildAnnotationPath(section);

    timer();
    this.logger.info('Annotation complete', {
      section,
      caseCount: dedupedCases.length,
      citationsProcessed: rawCases.length,
      duplicatesFound,
      path,
    });
    return ok({ annotation: parsed.data, path });
  }
}

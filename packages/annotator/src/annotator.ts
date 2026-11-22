import {
  type PrecedentAnnotation,
  PrecedentAnnotationSchema,
  resolveRefreshWithFallback,
  type Result,
  type SourceAcquisitionOutcome,
  ok,
  err,
} from '@civic-source/types';
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
  /** Relative output path: annotations/title-{n}/section-{n}.yaml */
  path: string;
}

type CourtType = 'SCOTUS' | 'Appellate' | 'District';

/** Map a CourtListener court ID to the schema court enum */
export function mapCourt(courtId: string): CourtType {
  const id = courtId.toLowerCase();
  if (id === 'scotus') return 'SCOTUS';
  if (/^ca\d{1,2}$/.test(id) || id === 'cadc' || id === 'cafc') return 'Appellate';
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
 * values that flow into the hand-rolled YAML sidecar. When truncation splits
 * a surrogate pair, the trailing lone high surrogate is dropped so the result
 * never ends in a broken character.
 */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max - 3;
  const lastKept = value.charCodeAt(end - 1);
  if (lastKept >= 0xd800 && lastKept <= 0xdbff) end -= 1;
  return value.slice(0, end) + '...';
}

/** Origin of the CourtListener site — a sourceUrl must resolve to this host. */
const COURTLISTENER_ORIGIN = new URL(COURTLISTENER_BASE_URL).origin;

/**
 * Resolve an untrusted CourtListener `absolute_url` into a same-origin source URL.
 */
export function courtListenerSourceUrl(absoluteUrl: string): string {
  try {
    const resolved = new URL(absoluteUrl, `${COURTLISTENER_ORIGIN}/`);
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
 */
export function buildAnnotationPath(section: string): string {
  const normalized = section.replace(/[§\u00A7]|&sect;/g, ' ').trim().replace(/\s+/g, ' ');
  const match = /^(\d+[a-zA-Z]?)\s+U\.?S\.?C\.?\s+([a-zA-Z0-9-]+)$/i.exec(normalized);
  if (!match) {
    const slug = section.replace(/[^a-zA-Z0-9-]/g, '_').toLowerCase();
    return `annotations/${slug}.yaml`;
  }
  const [, titleNum, sectionNum] = match;
  return `annotations/title-${titleNum}/section-${sectionNum}.yaml`;
}

/**
 * Escape a string for a YAML double-quoted scalar.
 */
function yamlEscape(s: string | undefined | null): string {
  if (s == null) return '';
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

/** Serialize a PrecedentAnnotation to simple YAML (no external deps), including USCT-004 retrieval evidence metadata */
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
    if (c.retrievalExcerpt !== undefined) {
      lines.push(`    retrievalExcerpt: "${yamlEscape(c.retrievalExcerpt)}"`);
    }
    if (c.reviewedProposition !== undefined) {
      lines.push(`    reviewedProposition: "${yamlEscape(c.reviewedProposition)}"`);
    }
    if (c.supportingOpinionPassage !== undefined) {
      lines.push(`    supportingOpinionPassage: "${yamlEscape(c.supportingOpinionPassage)}"`);
    }
    if (c.retrievalQuery !== undefined) {
      lines.push(`    retrievalQuery: "${yamlEscape(c.retrievalQuery)}"`);
    }
    if (c.retrievedAt !== undefined) {
      lines.push(`    retrievedAt: "${yamlEscape(c.retrievedAt)}"`);
    }
    if (c.extractionState !== undefined) {
      lines.push(`    extractionState: "${yamlEscape(c.extractionState)}"`);
    }
    if (c.editorialReview !== undefined) {
      lines.push(`    editorialReview: "${yamlEscape(c.editorialReview)}"`);
    }
    if (c.versionAlignmentState !== undefined) {
      lines.push(`    versionAlignmentState: "${yamlEscape(c.versionAlignmentState)}"`);
    }
    lines.push(`    sourceUrl: "${yamlEscape(c.sourceUrl)}"`);
    lines.push(`    impact: "${yamlEscape(c.impact)}"`);
    if (c.statuteVersionRef) {
      lines.push(`    statuteVersionRef: "${yamlEscape(c.statuteVersionRef)}"`);
    }
    if (c.statuteVersionNote) {
      lines.push(`    statuteVersionNote: "${yamlEscape(c.statuteVersionNote)}"`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Annotate a US Code section with precedent cases from CourtListener.
 *
 * USCT-004: Search snippets are explicitly recorded as unreviewed retrieval excerpts
 * (`extractionState: 'candidate'`, `editorialReview: 'unreviewed'`, `retrievalExcerpt`),
 * while preserving `holdingSummary` for legacy schema compatibility.
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

    const searchResult = await this.client.searchByStatute(section);
    if (!searchResult.ok) {
      timer();
      return searchResult;
    }

    const sorted = sortByCourtPriority(searchResult.value);
    const isoNow = new Date().toISOString();
    const sanitizedQuery = `"${section.replace(/["\\]/g, '').trim()}"`;

    const rawCases = sorted.map((result) => {
      const clampedExcerpt = truncate(result.snippet, MAX_HOLDING_SUMMARY_LENGTH);
      return {
        caseName: truncate(result.caseName, MAX_CASE_NAME_LENGTH),
        citation: truncate(result.citation[0] ?? '', MAX_CITATION_LENGTH),
        court: mapCourt(result.court),
        date: result.dateFiled,
        holdingSummary: clampedExcerpt,
        retrievalExcerpt: clampedExcerpt,
        retrievalQuery: truncate(sanitizedQuery, 200),
        retrievedAt: isoNow,
        extractionState: 'candidate' as const,
        editorialReview: 'unreviewed' as const,
        versionAlignmentState: 'unknown' as const,
        sourceUrl: courtListenerSourceUrl(result.absolute_url),
        impact: 'interpretation' as const,
      };
    });

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

  /**
   * Refresh annotations for a section with USCT-002 fallback semantics:
   * preserves prior validated annotations and marks them stale when CourtListener fails.
   */
  async annotateSectionWithOutcome(
    section: string,
    priorAnnotation?: PrecedentAnnotation | null
  ): Promise<SourceAcquisitionOutcome<PrecedentAnnotation>> {
    const observedAt = new Date().toISOString();
    const priorSnapshot = priorAnnotation
      ? { data: priorAnnotation, lastSuccessAt: priorAnnotation.lastSyncedET }
      : null;

    const result = await this.annotateSection(section);
    if (!result.ok) {
      const msg = result.error.message;
      const failureKind = /429|rate limit/i.test(msg)
        ? ('rate_limited' as const)
        : /401|500|502|503|504|HTTP/i.test(msg)
          ? ('http_error' as const)
          : /malformed|json/i.test(msg)
            ? ('malformed_payload' as const)
            : ('network_error' as const);

      const fallbackEmpty: PrecedentAnnotation = {
        targetSection: section,
        lastSyncedET: observedAt,
        cases: [],
      };

      return resolveRefreshWithFallback(
        {
          status: 'failed',
          source: 'courtlistener',
          scope: section,
          observedAt,
          data: fallbackEmpty,
          isEmpty: (a) => a.cases.length === 0,
          failureKind,
          errorMessage: msg,
        },
        priorSnapshot
      );
    }

    return resolveRefreshWithFallback(
      {
        status: result.value.annotation.cases.length === 0 ? 'success-empty' : 'success-nonempty',
        source: 'courtlistener',
        scope: section,
        observedAt,
        data: result.value.annotation,
        isEmpty: (a) => a.cases.length === 0,
      },
      priorSnapshot
    );
  }
}

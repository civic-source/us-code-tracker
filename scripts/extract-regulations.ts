#!/usr/bin/env npx tsx
/**
 * eCFR Candidate & Authority Sidecar Generator (USCT-002, USCT-003, USCT-014)
 *
 * Queries the open eCFR search API to discover administrative rules and CFR parts
 * mentioning U.S. Code sections, and optionally verifies official authority citations
 * against the CFR part's authority note / Parallel Table of Authorities (PTOA).
 *
 * Distinguishes:
 * - Full-text search matches -> extractionState: 'candidate', relationshipType: 'text_match_candidate' (USCT-003)
 * - Verified authority citations -> extractionState: 'verified', relationshipType: 'authority_citation' (USCT-014)
 * - Source outages / HTTP errors / partial pagination -> typed SourceAcquisitionOutcome preserving prior snapshot (USCT-002)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { buildEcfrPartUrl } from '@civic-source/shared';
import {
  SectionRegulationsSchema,
  resolveRefreshWithFallback,
  type ImplementingRegulation,
  type SectionRegulations,
  type SourceAcquisitionOutcome,
  type SourceFetchFailureKind,
} from '@civic-source/types';

export interface ECFRSearchResult {
  hierarchy?: {
    title?: string;
    part?: string;
    chapter?: string;
  };
  headings?: {
    title?: string;
    part?: string;
    chapter?: string;
  };
  full_text_excerpt?: string;
  removed?: boolean;
  reserved?: boolean;
  ends_on?: string | null;
}

export interface FetchRegulationsOptions {
  /** Optional authority lookup map or callback for verifying official PTOA / CFR Part authority notes (USCT-014) */
  verifyAuthority?: (cfrTitle: number, cfrPart: number) => Promise<string | null> | string | null;
  /** Optional editorial review state when authority is verified (defaults to 'unreviewed' for machine verification, AUD-009) */
  verifiedEditorialReview?: 'unreviewed' | 'accepted';
  /** Maximum pages to fetch when eCFR search results span multiple pages (defaults to 10, AUD-009) */
  maxPages?: number;
  /** Optional prior validated snapshot to preserve when refresh fails (USCT-002) */
  priorSnapshot?: { data: ImplementingRegulation[]; lastSuccessAt: string } | null;
  /** Custom timestamp for deterministic testing */
  nowIso?: string;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check whether an official CFR authority string actually cites the target USC title and section (USCT-003 / USCT-014).
 * Example authority text: "Authority: 42 U.S.C. 7401-7671q." or "18 U.S.C. 111, 1114."
 */
export function authorityTextCitesSection(
  authorityText: string,
  uscTitle: string | number,
  uscSection: string
): boolean {
  const t = escapeRegExp(String(uscTitle).trim());
  const s = escapeRegExp(String(uscSection).trim());
  // Match "{title} U.S.C. {section}" or "{title} U.S.C. § {section}" with word boundary after section
  const directPattern = new RegExp(`\\b${t}\\s+U\\.?S\\.?C\\.?\\s*(?:§+|sec\\.?|sections?)?\\s*${s}(?![0-9a-zA-Z])`, 'i');
  return directPattern.test(authorityText);
}

/**
 * Fetch eCFR regulation candidates with full USCT-002 outcome semantics and USCT-003/014 candidate vs. verified classification.
 */
export async function fetchRegulationsWithOutcome(
  uscTitle: string | number,
  uscSection: string,
  options?: FetchRegulationsOptions
): Promise<SourceAcquisitionOutcome<ImplementingRegulation[]>> {
  const scope = `${uscTitle} U.S.C. ${uscSection}`;
  const query = `"${uscTitle} U.S.C. ${uscSection}"`;
  const baseUrl = `https://www.ecfr.gov/api/search/v1/results?query=${encodeURIComponent(query)}&per_page=20`;
  const observedAt = options?.nowIso ?? new Date().toISOString();
  const maxPages = options?.maxPages ?? 10;

  try {
    const regulationsMap = new Map<string, ImplementingRegulation>();
    let completedPages = 0;
    let expectedPages = 1;
    let lastStatus = 200;
    let pageFailureReason: string | undefined;

    for (let page = 1; page <= expectedPages && page <= maxPages; page++) {
      const pageUrl = page === 1 ? baseUrl : `${baseUrl}&page=${page}`;
      let res: Response;
      try {
        res = await fetch(pageUrl);
      } catch (pageErr: unknown) {
        if (page === 1) throw pageErr;
        pageFailureReason = `eCFR page ${page} network failure: ${pageErr instanceof Error ? pageErr.message : String(pageErr)}`;
        break;
      }

      lastStatus = res.status;
      if (!res.ok) {
        if (page === 1) {
          const failureKind: SourceFetchFailureKind =
            res.status === 429 ? 'rate_limited' : 'http_error';
          return resolveRefreshWithFallback(
            {
              status: 'failed',
              source: 'ecfr',
              scope,
              observedAt,
              data: [],
              isEmpty: (d) => d.length === 0,
              httpStatus: res.status,
              failureKind,
              errorMessage: `eCFR search API returned HTTP ${res.status}`,
            },
            options?.priorSnapshot
          );
        }
        pageFailureReason = `eCFR search API page ${page} returned HTTP ${res.status}`;
        break;
      }

      let rawData: unknown;
      try {
        rawData = await res.json();
      } catch (parseErr: unknown) {
        if (page === 1) {
          return resolveRefreshWithFallback(
            {
              status: 'failed',
              source: 'ecfr',
              scope,
              observedAt,
              data: [],
              isEmpty: (d) => d.length === 0,
              httpStatus: res.status,
              failureKind: 'malformed_payload',
              errorMessage: `Malformed JSON from eCFR API: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
            },
            options?.priorSnapshot
          );
        }
        pageFailureReason = `Malformed JSON on eCFR page ${page}`;
        break;
      }

      if (
        typeof rawData !== 'object' ||
        rawData === null ||
        !('results' in rawData) ||
        !Array.isArray((rawData as { results?: unknown }).results)
      ) {
        if (page === 1) {
          return resolveRefreshWithFallback(
            {
              status: 'failed',
              source: 'ecfr',
              scope,
              observedAt,
              data: [],
              isEmpty: (d) => d.length === 0,
              httpStatus: res.status,
              failureKind: 'malformed_payload',
              errorMessage: 'eCFR payload missing results array',
            },
            options?.priorSnapshot
          );
        }
        pageFailureReason = `eCFR page ${page} missing results array`;
        break;
      }

      const items = (
        rawData as {
          results: ECFRSearchResult[];
          meta?: { total_pages?: number; current_page?: number; page_failure?: boolean };
        }
      ).results;
      const meta = (
        rawData as {
          meta?: { total_pages?: number; current_page?: number; page_failure?: boolean };
        }
      ).meta;

      const parsedTotal = parseInt(String(meta?.total_pages ?? '1'), 10);
      if (!Number.isNaN(parsedTotal) && parsedTotal >= 1) {
        expectedPages = parsedTotal;
      }

      for (const item of items) {
        const cfrTitle = parseInt(item.hierarchy?.title ?? '', 10);
        const cfrPart = parseInt(item.hierarchy?.part ?? '', 10);
        if (isNaN(cfrTitle) || isNaN(cfrPart) || cfrTitle <= 0 || cfrPart <= 0) {
          continue;
        }
        if (item.removed === true && !item.ends_on) {
          continue;
        }

        const key = `${cfrTitle}-${cfrPart}`;
        if (regulationsMap.has(key)) continue;

        const agency =
          item.headings?.chapter?.trim() || item.headings?.title?.trim() || 'Federal Agency';
        const description = item.headings?.part?.trim() || undefined;
        const ecfrUrl = buildEcfrPartUrl(cfrTitle, cfrPart, item.ends_on);
        const excerpt = item.full_text_excerpt?.trim().slice(0, 1000);

        let extractionState: 'candidate' | 'verified' = 'candidate';
        let editorialReview: 'unreviewed' | 'accepted' = 'unreviewed';
        let relationshipType: 'text_match_candidate' | 'authority_citation' =
          'text_match_candidate';
        let verifiedAuthorityText: string | undefined;

        if (options?.verifyAuthority) {
          const authText = await options.verifyAuthority(cfrTitle, cfrPart);
          if (authText && authorityTextCitesSection(authText, uscTitle, uscSection)) {
            extractionState = 'verified';
            // Machine verification establishes extractionState='verified', keeping editorialReview='unreviewed' unless explicitly accepted (AUD-009)
            editorialReview = options.verifiedEditorialReview ?? 'unreviewed';
            relationshipType = 'authority_citation';
            verifiedAuthorityText = authText.trim().slice(0, 1000);
          }
        }

        regulationsMap.set(key, {
          cfrTitle,
          cfrPart,
          agency,
          description,
          ecfrUrl,
          extractionState,
          editorialReview,
          relationshipType,
          discoveryQuery: query,
          matchingEvidence: excerpt ?? `Matched eCFR full-text search for ${query}`,
          verifiedAuthorityText,
          retrievedAt: observedAt,
        });
      }

      completedPages = page;
      if (meta?.page_failure) {
        pageFailureReason = 'eCFR search pagination interrupted before all pages were collected';
        break;
      }
    }

    const regulations = Array.from(regulationsMap.values());

    if (pageFailureReason || completedPages < expectedPages) {
      return resolveRefreshWithFallback(
        {
          status: 'partial',
          source: 'ecfr',
          scope,
          observedAt,
          data: regulations,
          isEmpty: (d) => d.length === 0,
          httpStatus: lastStatus,
          failureKind: 'pagination_incomplete',
          errorMessage:
            pageFailureReason ??
            `eCFR search pagination incomplete (${completedPages} of ${expectedPages} pages collected)`,
          completedPages,
          expectedPages,
        },
        options?.priorSnapshot
      );
    }

    return resolveRefreshWithFallback(
      {
        status: regulations.length === 0 ? 'success-empty' : 'success-nonempty',
        source: 'ecfr',
        scope,
        observedAt,
        data: regulations,
        isEmpty: (d) => d.length === 0,
        completedPages,
        expectedPages,
      },
      options?.priorSnapshot
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = /timeout|abort/i.test(msg);
    return resolveRefreshWithFallback(
      {
        status: 'failed',
        source: 'ecfr',
        scope,
        observedAt,
        data: [],
        isEmpty: (d) => d.length === 0,
        failureKind: isTimeout ? 'timeout' : 'network_error',
        errorMessage: msg,
      },
      options?.priorSnapshot
    );
  }
}

/**
 * Legacy helper returning the array of discovered regulation records.
 * Each record resulting from full-text search is explicitly labeled `extractionState: 'candidate'`
 * and `relationshipType: 'text_match_candidate'` unless verified via `options.verifyAuthority` (USCT-003).
 */
export async function fetchImplementingRegulations(
  uscTitle: string | number,
  uscSection: string,
  options?: FetchRegulationsOptions
): Promise<ImplementingRegulation[]> {
  const outcome = await fetchRegulationsWithOutcome(uscTitle, uscSection, options);
  return outcome.data;
}

/** Load an existing section regulations sidecar so a failed refresh preserves last-good data (USCT-002) */
export async function loadExistingSectionRegulations(filePath: string): Promise<SectionRegulations | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return SectionRegulationsSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function serializeValidatedSidecar(parsed: SectionRegulations): string {
  const raw = JSON.stringify(parsed, null, 2);
  const codes: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    codes.push(raw.charCodeAt(i) & 0xffff);
  }
  return codes.map((c) => String.fromCharCode(c)).join('');
}

async function main() {
  const { values } = parseArgs({
    options: {
      title: { type: 'string', short: 't' },
      section: { type: 'string', short: 's' },
      output: { type: 'string', short: 'o', default: 'apps/web/content-data/regulations' },
    },
  });

  if (!values.title || !values.section) {
    console.error('Usage: extract-regulations.ts --title <num> --section <sec> [--output <dir>]');
    process.exit(1);
  }

  const { title, section, output } = values;
  const outDir = join(output, `title-${title}`);
  const outFile = join(outDir, `section-${section}.json`);

  const existing = await loadExistingSectionRegulations(outFile);
  const priorSnapshot = existing
    ? {
        data: existing.regulations,
        lastSuccessAt: existing.refreshStatus?.lastSuccessAt ?? existing.lastUpdated,
      }
    : null;

  console.log(`Extracting eCFR regulation candidates for ${title} U.S.C. § ${section}...`);
  const outcome = await fetchRegulationsWithOutcome(title, section, { priorSnapshot });
  console.log(
    `Outcome: ${outcome.status} (${outcome.data.length} parts, retainedPrior=${outcome.retainedPriorSnapshot})`
  );

  const parsed = SectionRegulationsSchema.parse({
    targetSection: `${title}-${section}`,
    lastUpdated: outcome.observedAt,
    refreshStatus: {
      source: outcome.source,
      scope: outcome.scope,
      status: outcome.status,
      observedAt: outcome.observedAt,
      lastSuccessAt: outcome.lastSuccessAt,
      retainedPriorSnapshot: outcome.retainedPriorSnapshot,
      isStale: outcome.isStale,
      httpStatus: outcome.httpStatus,
      failureKind: outcome.failureKind,
      errorMessage: outcome.errorMessage,
      completedPages: outcome.completedPages,
      expectedPages: outcome.expectedPages,
    },
    regulations: outcome.data,
  });

  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, serializeValidatedSidecar(parsed), 'utf-8');
  console.log(`Wrote sidecar to: ${outFile}`);
}

if (process.argv[1]?.endsWith('extract-regulations.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

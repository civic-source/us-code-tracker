/**
 * Scrape and parse OLRC prior release points into a chronological timeline.
 *
 * Preserves full provider release identifiers including exclusion suffixes
 * (e.g., `119/73not60` -> `pl-119-73not60`) per USCT-006.
 */

import { OLRC_BASE_URL } from '../../packages/fetcher/src/index.js';

const PRIOR_RELEASE_POINTS_URL = `${OLRC_BASE_URL}/download/releasepoints/`;

/** A parsed release point identifier */
export interface ReleasePointId {
  /** Congress number (e.g. 113, 118, 119) */
  congress: number;
  /** Numeric base law number within that congress (e.g. 100, 73) */
  law: number;
  /** Lossless law segment from OLRC URL, including exclusions (e.g. "73" or "73not60") */
  lawSegment?: string;
  /** Excluded law numbers if present (e.g. ["60"]) */
  exclusions?: string[];
  /** Display string: "PL {congress}-{lawSegment}" */
  label: string;
}

/** Canonical release key used in checkpoint ledgers and Git tags (e.g., "119-73" or "119-73not60") */
export function releasePointKey(rp: ReleasePointId): string {
  const seg = rp.lawSegment ?? String(rp.law);
  return `${rp.congress}-${seg}`;
}

/** Canonical Git tag name for a release point (e.g., "pl-119-73" or "pl-119-73not60") */
export function releasePointTagName(rp: ReleasePointId, revision = 1): string {
  const base = `pl-${releasePointKey(rp)}`;
  return revision > 1 ? `${base}-rev${revision}` : base;
}

/**
 * Known major release points (one per congress end-of-session).
 * Used as fallback when the OLRC index page is unavailable.
 */
export const CACHED_RELEASE_POINTS: ReleasePointId[] = [
  // 113th Congress (2013-2014)
  { congress: 113, law: 100, lawSegment: '100', label: 'PL 113-100' },
  { congress: 113, law: 235, lawSegment: '235', label: 'PL 113-235' },
  // 114th Congress (2015-2016)
  { congress: 114, law: 113, lawSegment: '113', label: 'PL 114-113' },
  { congress: 114, law: 254, lawSegment: '254', label: 'PL 114-254' },
  // 115th Congress (2017-2018)
  { congress: 115, law: 97, lawSegment: '97', label: 'PL 115-97' },
  { congress: 115, law: 232, lawSegment: '232', label: 'PL 115-232' },
  // 116th Congress (2019-2020)
  { congress: 116, law: 92, lawSegment: '92', label: 'PL 116-92' },
  { congress: 116, law: 260, lawSegment: '260', label: 'PL 116-260' },
  // 117th Congress (2021-2022)
  { congress: 117, law: 81, lawSegment: '81', label: 'PL 117-81' },
  { congress: 117, law: 200, lawSegment: '200', label: 'PL 117-200' },
  // 118th Congress (2023-2024)
  { congress: 118, law: 31, lawSegment: '31', label: 'PL 118-31' },
  { congress: 118, law: 100, lawSegment: '100', label: 'PL 118-100' },
  // 119th Congress (2025-2026)
  { congress: 119, law: 4, lawSegment: '4', label: 'PL 119-4' },
  { congress: 119, law: 73, lawSegment: '73', label: 'PL 119-73' },
].sort(compareReleasePoints);

/** Compare release points chronologically (congress first, then law number, then exclusion before full) */
export function compareReleasePoints(a: ReleasePointId, b: ReleasePointId): number {
  if (a.congress !== b.congress) return a.congress - b.congress;
  if (a.law !== b.law) return a.law - b.law;
  const segA = a.lawSegment ?? String(a.law);
  const segB = b.lawSegment ?? String(b.law);
  if (segA === segB) return 0;
  // Exclusion-bearing release (e.g. 73not60) comes chronologically before full 73
  if (segA.includes('not') && !segB.includes('not')) return -1;
  if (!segA.includes('not') && segB.includes('not')) return 1;
  return segA.localeCompare(segB);
}

/** Parse a "pl/{congress}/{lawSegment}" string (e.g. "pl/119/73" or "pl/119/73not60") into a ReleasePointId */
export function parseReleasePointStr(str: string): ReleasePointId | null {
  const match = /^pl\/(\d+)\/((\d+)(not(\d+(?:and\d+)*))?)$/i.exec(str);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const congress = parseInt(match[1], 10);
  const lawSegment = match[2].toLowerCase();
  const law = parseInt(match[3], 10);
  const exclusions = match[5] ? match[5].split(/and/i) : undefined;
  return {
    congress,
    law,
    lawSegment,
    ...(exclusions ? { exclusions } : {}),
    label: `PL ${congress}-${lawSegment}`,
  };
}

/**
 * Build the download URL for a specific title at a given release point.
 * Pattern: https://uscode.house.gov/download/releasepoints/us/pl/{congress}/{lawSegment}/xml_usc{NN}@{congress}-{lawSegment}.zip
 */
export function titleZipUrl(rp: ReleasePointId, paddedTitle: string): string {
  const seg = rp.lawSegment ?? String(rp.law);
  return `${PRIOR_RELEASE_POINTS_URL}us/pl/${rp.congress}/${seg}/xml_usc${paddedTitle}@${rp.congress}-${seg}.zip`;
}

/**
 * Scrape the OLRC release points index page and extract all PL directories (including exclusions).
 * Returns release points sorted chronologically (oldest first).
 * Falls back to CACHED_RELEASE_POINTS if the index page is unavailable.
 */
export async function scrapeReleasePoints(
  fetchFn: typeof fetch = fetch
): Promise<ReleasePointId[]> {
  try {
    const response = await fetchFn(PRIOR_RELEASE_POINTS_URL);
    if (response.ok) {
      const html = await response.text();
      const points: ReleasePointId[] = [];

      // Match directory links like: us/pl/113/100/ or us/pl/119/73not60/
      const pattern = /href="[^"]*?us\/pl\/(\d+)\/(\d+(?:not\d+(?:and\d+)*)?)\/?/gi;
      let match: RegExpExecArray | null;

      const seen = new Set<string>();
      while ((match = pattern.exec(html)) !== null) {
        const congress = match[1];
        const lawSegment = match[2]?.toLowerCase();
        if (!congress || !lawSegment) continue;

        const key = `${congress}-${lawSegment}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const parsed = parseReleasePointStr(`pl/${congress}/${lawSegment}`);
        if (parsed) {
          points.push(parsed);
        }
      }

      points.sort(compareReleasePoints);
      return points;
    }
  } catch {
    // Fall through to cached list
  }

  // Try loading from verified release points file
  try {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const verifiedPath = join(thisDir, 'verified-release-points.txt');
    const lines = readFileSync(verifiedPath, 'utf-8').trim().split('\n');
    const verified: ReleasePointId[] = [];
    for (const line of lines) {
      const rp = parseReleasePointStr(`pl/${line.trim()}`);
      if (rp) verified.push(rp);
    }
    if (verified.length > 0) {
      verified.sort(compareReleasePoints);
      return verified;
    }
  } catch {
    // Fall through to cached
  }

  return [...CACHED_RELEASE_POINTS];
}

/** Filter release points to a range (inclusive) */
export function filterRange(
  points: readonly ReleasePointId[],
  start?: ReleasePointId | undefined,
  end?: ReleasePointId | undefined
): ReleasePointId[] {
  return points.filter((p) => {
    if (start && compareReleasePoints(p, start) < 0) return false;
    if (end && compareReleasePoints(p, end) > 0) return false;
    return true;
  });
}

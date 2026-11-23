import { createHash } from 'node:crypto';
import { type IUsCodeFetcher, type ReleasePoint, type Result, ok, err } from '@civic-source/types';
import {
  type Logger,
  createLogger,
  fetchWithRetry as sharedFetchWithRetry,
  normalizeUscTitle,
} from '@civic-source/shared';
import {
  OLRC_DOWNLOAD_PAGE,
  OLRC_LEGACY_DOWNLOAD_PAGE,
  OLRC_PRIOR_RELEASE_POINTS_PAGE,
  OLRC_LEGACY_PRIOR_RELEASE_POINTS_PAGE,
  MAX_DOWNLOAD_BYTES,
  titleXmlUrl,
} from './constants.js';
import { HashStore } from './hash-store.js';
import { FetcherMetrics } from './metrics.js';

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

/** Compute SHA-256 hex digest of a buffer */
export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Inspect a response's Content-Length header and reject up-front if it
 * advertises a body larger than MAX_DOWNLOAD_BYTES. This is the primary guard
 * against runner OOM: it avoids ever reading an oversized body into memory.
 */
export function exceedsContentLengthLimit(response: Response): boolean {
  const header = response.headers.get('content-length');
  if (header === null) return false;
  const declared = Number(header);
  if (!Number.isFinite(declared)) return false;
  return declared > MAX_DOWNLOAD_BYTES;
}

/**
 * Read a response body into a Buffer, enforcing a hard byte cap.
 *
 * Streams the body and cancels immediately if the running total exceeds
 * `maxBytes`, preventing chunked or untruthful-Content-Length OOMs.
 */
export async function readBytesCapped(
  response: Response,
  maxBytes: number = MAX_DOWNLOAD_BYTES
): Promise<Buffer | null> {
  const body = response.body;
  if (body === null) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length > maxBytes ? null : buffer;
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * Read an HTML response body as a UTF-8 string, enforcing a hard byte cap.
 * Concatenates first before UTF-8 decoding so split multi-byte characters stay intact.
 */
export async function readBodyCapped(
  response: Response,
  maxBytes: number = MAX_DOWNLOAD_BYTES
): Promise<string | null> {
  const bytes = await readBytesCapped(response, maxBytes);
  return bytes === null ? null : bytes.toString('utf-8');
}

/** Fetch with exponential backoff retry via `@civic-source/shared`. */
export async function fetchWithRetry(
  url: string,
  logger: Logger
): Promise<Result<Response>> {
  return sharedFetchWithRetry(url, { logger });
}

/** Format validated calendar components into `YYYY-MM-DDT00:00:00.000Z`. */
function toIsoMidnightUtc(year: number, monthIndex: number, day: number): string | undefined {
  const dt = new Date(Date.UTC(year, monthIndex, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== monthIndex ||
    dt.getUTCDate() !== day
  ) {
    return undefined;
  }
  const yyyy = String(year).padStart(4, '0');
  const mm = String(monthIndex + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
}

/**
 * Parse an OLRC release date in either legacy numeric form (`MM/DD/YYYY`)
 * or Nov-2026 prose form (`Month D, YYYY`) into UTC ISO 8601 midnight.
 */
export function parseOlrcDateToIso(raw: string): string | undefined {
  const trimmed = raw.trim();
  const numericMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (numericMatch?.[1] && numericMatch[2] && numericMatch[3]) {
    const month = Number(numericMatch[1]);
    const day = Number(numericMatch[2]);
    const year = Number(numericMatch[3]);
    return toIsoMidnightUtc(year, month - 1, day);
  }

  const proseMatch = /^([A-Za-z]{3,12})\s+(\d{1,2}),\s*(\d{4})$/.exec(trimmed);
  if (proseMatch?.[1] && proseMatch[2] && proseMatch[3]) {
    const monthIndex = MONTH_INDEX[proseMatch[1].toLowerCase()];
    if (monthIndex === undefined) return undefined;
    const day = Number(proseMatch[2]);
    const year = Number(proseMatch[3]);
    return toIsoMidnightUtc(year, monthIndex, day);
  }

  return undefined;
}

export interface ParsedPriorReleasePoint {
  publicLaw: string;
  congress: string;
  law: string;
  dateET: string;
  path: string;
}

/** Compare prior release points chronologically (oldest first, exclusions before full). */
function compareParsedPriorReleasePoints(
  a: ParsedPriorReleasePoint,
  b: ParsedPriorReleasePoint
): number {
  const byDate = a.dateET.localeCompare(b.dateET);
  if (byDate !== 0) return byDate;
  if (a.law.includes('not') && !b.law.includes('not')) return -1;
  if (!a.law.includes('not') && b.law.includes('not')) return 1;
  return a.law.localeCompare(b.law);
}

/**
 * Parse prior release points HTML across both current Nov-2026 static format
 * (`download/{congress}-{law}.html` + `Month D, YYYY`) and legacy `.htm` format
 * (`/download/releasepoints/us/pl/{congress}/{law}/usc-rp@...htm` + `MM/DD/YYYY`).
 * Uses bounded quantifiers to avoid polynomial ReDoS backtracking.
 */
export function parsePriorReleasePoints(html: string): ParsedPriorReleasePoint[] {
  const results: ParsedPriorReleasePoint[] = [];
  const seenKeys = new Set<string>();

  // 1. Legacy format:
  // <a class="releasepoint" href="/download/releasepoints/us/pl/119/73not60/usc-rp@119-73not60.htm">
  //   Public Law 119-73 (01/23/2026)</a>
  const legacyPattern =
    /href="(\/download\/releasepoints\/us\/pl\/(\d{2,3})\/([^"/]{1,40})\/usc-rp@[^"/]{1,60}\.htm)"[^>]{0,200}>\s*Public\s+Law\s+(\d{2,3}-\d+)\s*\(([^()]{4,40})\)/g;
  let match: RegExpExecArray | null;
  while ((match = legacyPattern.exec(html)) !== null) {
    const path = match[1];
    const congress = match[2];
    const law = match[3]?.toLowerCase();
    const publicLawNum = match[4];
    const isoDate = match[5] ? parseOlrcDateToIso(match[5]) : undefined;
    if (!path || !congress || !law || !publicLawNum || !isoDate) continue;

    const key = `${congress}-${law}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    results.push({
      publicLaw: `PL ${publicLawNum}`,
      congress,
      law,
      dateET: isoDate,
      path,
    });
  }

  // 2. New Nov-2026 format:
  // <a class="releasepoint" href="download/119-138.html">Public Law 119-138 (November 3, 2026), affecting titles 21, 22.</a>
  // <a class="releasepoint" href="download/119-102not101.html">Public Law 119-102not101 (July 12, 2026), except 119-101...</a>
  const modernPattern =
    /href="(?:\/?download\/)?(\d{2,3})-([0-9a-zA-Z]{1,40})\.html"[^>]{0,200}>\s*Public\s+Law\s+(\d{2,3})-([0-9a-zA-Z]{1,40})\s*\(([^()]{4,40})\)/gi;
  while ((match = modernPattern.exec(html)) !== null) {
    const congress = match[1];
    const law = match[2]?.toLowerCase();
    const textCongress = match[3];
    const textLaw = match[4]?.toLowerCase();
    const isoDate = match[5] ? parseOlrcDateToIso(match[5]) : undefined;
    if (!congress || !law || !textCongress || !textLaw || !isoDate) continue;
    if (!/^\d+(?:not\d+(?:and\d+)*)?$/.test(law)) continue;

    const key = `${congress}-${law}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    results.push({
      publicLaw: `PL ${textCongress}-${textLaw}`,
      congress,
      law,
      dateET: isoDate,
      path: `/download/releasepoints/us/pl/${congress}/${law}/`,
    });
  }

  results.sort(compareParsedPriorReleasePoints);
  return results;
}

export interface CurrentReleaseInfo {
  publicLaw: string;
  congress: string;
  law: string;
  dateET: string;
}

/**
 * Parse the current release point from the main OLRC download page header
 * across legacy numeric dates (`MM/DD/YYYY`) and Nov-2026 prose dates (`Month D, YYYY`).
 */
export function parseCurrentRelease(html: string): CurrentReleaseInfo | undefined {
  const datedPattern =
    /Public\s+Law\s+(\d{2,3})-(\d+(?:not\d+(?:and\d+)*)?)\s*\(([^()]{4,40})\)/gi;
  let match: RegExpExecArray | null;
  while ((match = datedPattern.exec(html)) !== null) {
    const congress = match[1];
    const law = match[2]?.toLowerCase();
    const isoDate = match[3] ? parseOlrcDateToIso(match[3]) : undefined;
    if (congress && law && isoDate) {
      return {
        publicLaw: `PL ${congress}-${law}`,
        congress,
        law,
        dateET: isoDate,
      };
    }
  }

  const headerOnlyPattern =
    /<h3[^>]{0,120}class="releasepointinformation"[^>]{0,120}>\s*Public\s+Law\s+(\d{2,3})-(\d+(?:not\d+(?:and\d+)*)?)\s*<\/h3>/i;
  const headerMatch = headerOnlyPattern.exec(html);
  if (headerMatch?.[1] && headerMatch[2]) {
    const congress = headerMatch[1];
    const law = headerMatch[2].toLowerCase();
    return {
      publicLaw: `PL ${congress}-${law}`,
      congress,
      law,
      dateET: '',
    };
  }

  return undefined;
}

/**
 * Parse release point title-level ZIP links from the OLRC download page HTML.
 * Reconstructs every `uslmUrl` canonically on `uscode.house.gov` via `titleXmlUrl`.
 */
export function parseReleasePoints(html: string): ReleasePoint[] {
  const results: ReleasePoint[] = [];
  const currentRelease = parseCurrentRelease(html);

  const linkPattern =
    /href="(?:\/?download\/)?releasepoints\/us\/pl\/(\d+)\/([^/"]+)\/xml_usc[^"/]+\.zip"/g;
  let match: RegExpExecArray | null;

  const titlePattern = /xml_usc(\d+[a-zA-Z]?)@/;
  const seen = new Set<string>();

  while ((match = linkPattern.exec(html)) !== null) {
    const congress = match[1];
    const law = match[2];
    if (!congress || !law) continue;

    const titleMatch = titlePattern.exec(match[0]);
    if (!titleMatch) continue;

    const title = titleMatch[1];
    if (!title || seen.has(title)) continue;
    seen.add(title);

    let fullUrl: string;
    try {
      fullUrl = titleXmlUrl(congress, law, title);
    } catch {
      continue;
    }

    results.push({
      title,
      publicLaw: currentRelease?.publicLaw ?? '',
      dateET: currentRelease && currentRelease.dateET ? currentRelease.dateET : new Date().toISOString(),
      uslmUrl: fullUrl,
      sha256Hash: '0'.repeat(64),
    });
  }
  return results;
}

/** True only when `fetchWithRetry` surfaced an upstream HTTP 404 error. */
function isHttp404Error(error: Error): boolean {
  return /^HTTP 404(?:\b|:)/.test(error.message);
}

/**
 * OLRC US Code fetcher implementation.
 * Downloads XML release points with hash-based caching, dual-format HTML parsing,
 * and 404-only fallback from modern `.html` endpoints to legacy `.shtml`/`.htm` endpoints.
 */
export class OlrcFetcher implements IUsCodeFetcher {
  private readonly logger: Logger;
  private readonly hashStore: HashStore;
  readonly metrics: FetcherMetrics;

  constructor(options?: { logger?: Logger; hashStore?: HashStore; metrics?: FetcherMetrics }) {
    this.logger = options?.logger ?? createLogger('OlrcFetcher');
    this.hashStore = options?.hashStore ?? new HashStore();
    this.metrics = options?.metrics ?? new FetcherMetrics();
  }

  /**
   * Fetch an OLRC HTML index page, falling back to `legacyUrl` strictly when
   * `primaryUrl` returns HTTP 404 (so 5xx/timeout/SSRF outages still fail loudly).
   */
  private async fetchPageWith404Fallback(
    primaryUrl: string,
    legacyUrl: string,
    label: string
  ): Promise<Result<string>> {
    let responseRes = await fetchWithRetry(primaryUrl, this.logger);
    if (!responseRes.ok) {
      if (!isHttp404Error(responseRes.error)) {
        return responseRes;
      }
      this.logger.warn(`Primary OLRC ${label} returned HTTP 404; falling back to legacy URL`, {
        primaryUrl,
        legacyUrl,
      });
      responseRes = await fetchWithRetry(legacyUrl, this.logger);
      if (!responseRes.ok) {
        return responseRes;
      }
    }

    if (exceedsContentLengthLimit(responseRes.value)) {
      return err(new Error('Download exceeds size limit'));
    }

    const html = await readBodyCapped(responseRes.value);
    if (html === null) {
      return err(new Error('Download exceeds size limit'));
    }
    return ok(html);
  }

  /** List available release points from the current download page, optionally filtered by title. */
  async listReleasePoints(title?: string): Promise<Result<ReleasePoint[]>> {
    this.logger.info('Fetching release points', { title });
    const timer = this.logger.startTimer('listReleasePoints');

    const htmlResult = await this.fetchPageWith404Fallback(
      OLRC_DOWNLOAD_PAGE,
      OLRC_LEGACY_DOWNLOAD_PAGE,
      'download page'
    );
    if (!htmlResult.ok) {
      timer();
      return htmlResult;
    }

    let points = parseReleasePoints(htmlResult.value);
    this.metrics.recordDiscovered(points.length);

    if (title !== undefined) {
      const targetNorm = normalizeUscTitle(title) ?? title;
      points = points.filter((p) => {
        const entryNorm = normalizeUscTitle(p.title) ?? p.title;
        return p.title === title || entryNorm === targetNorm;
      });
    }

    timer();
    this.logger.info('Found release points', { count: points.length });
    return ok(points);
  }

  /**
   * List historical release points from the prior release points page plus
   * the current release point, returned oldest first.
   */
  async listHistoricalReleasePoints(): Promise<Result<ParsedPriorReleasePoint[]>> {
    this.logger.info('Fetching historical release points index');
    const timer = this.logger.startTimer('listHistoricalReleasePoints');

    const priorHtmlRes = await this.fetchPageWith404Fallback(
      OLRC_PRIOR_RELEASE_POINTS_PAGE,
      OLRC_LEGACY_PRIOR_RELEASE_POINTS_PAGE,
      'prior release points page'
    );
    if (!priorHtmlRes.ok) {
      timer();
      return priorHtmlRes;
    }

    const historicalPoints = parsePriorReleasePoints(priorHtmlRes.value);
    this.metrics.recordDiscovered(historicalPoints.length);

    const currentHtmlRes = await this.fetchPageWith404Fallback(
      OLRC_DOWNLOAD_PAGE,
      OLRC_LEGACY_DOWNLOAD_PAGE,
      'download page'
    );
    if (currentHtmlRes.ok) {
      const current = parseCurrentRelease(currentHtmlRes.value);
      if (current) {
        const alreadyIncluded = historicalPoints.some(
          (p) => p.publicLaw === current.publicLaw
        );
        if (!alreadyIncluded) {
          historicalPoints.push({
            publicLaw: current.publicLaw,
            congress: current.congress,
            law: current.law,
            dateET: current.dateET,
            path: `/download/releasepoints/us/pl/${current.congress}/${current.law}/`,
          });
          historicalPoints.sort(compareParsedPriorReleasePoints);
        }
      }
    }

    timer();
    this.logger.info('Found historical release points', { count: historicalPoints.length });
    return ok(historicalPoints);
  }

  /** Download and extract XML for a release point with hash-based caching. */
  async fetchXml(releasePoint: ReleasePoint): Promise<Result<string>> {
    this.logger.info('Fetching XML', { title: releasePoint.title, url: releasePoint.uslmUrl });
    const timer = this.logger.startTimer('fetchXml');
    const startMs = performance.now();

    const result = await fetchWithRetry(releasePoint.uslmUrl, this.logger);
    if (!result.ok) {
      const durationMs = performance.now() - startMs;
      this.metrics.recordDuration(durationMs);
      this.metrics.recordError('network');
      timer();
      return result;
    }

    if (exceedsContentLengthLimit(result.value)) {
      const durationMs = performance.now() - startMs;
      this.metrics.recordDuration(durationMs);
      this.metrics.recordError('network');
      timer();
      return err(new Error('Download exceeds size limit'));
    }

    const buffer = await readBytesCapped(result.value);
    if (buffer === null) {
      const durationMs = performance.now() - startMs;
      this.metrics.recordDuration(durationMs);
      this.metrics.recordError('network');
      timer();
      return err(new Error('Download exceeds size limit'));
    }

    const hash = sha256(buffer);
    const hashKey = `xml:${releasePoint.title}:${releasePoint.uslmUrl}`;

    const changed = await this.hashStore.hasChanged(hashKey, hash);
    if (!changed) {
      this.logger.info('Content unchanged, skipping', { title: releasePoint.title, hash });
      const durationMs = performance.now() - startMs;
      this.metrics.recordDuration(durationMs);
      this.metrics.recordSkipped();
      timer();
      return ok('');
    }

    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      const durationMs = performance.now() - startMs;
      this.metrics.recordDuration(durationMs);
      this.metrics.recordError('non-zip');
      timer();
      return err(new Error('Downloaded content is not a valid ZIP file'));
    }

    await this.hashStore.setHash(hashKey, hash);
    const durationMs = performance.now() - startMs;
    this.metrics.recordDuration(durationMs);
    this.metrics.recordDownloaded();
    timer();

    return ok(buffer.toString('base64'));
  }
}

import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  parseCurrentRelease,
  parsePriorReleasePoints,
  parseReleasePoints,
  readBodyCapped,
} from '@civic-source/fetcher';
import {
  OLRC_BROWSE_URL,
  OLRC_CLASSIFICATION_TABLES_URL,
  OLRC_CODIFICATION_URL,
  OLRC_DOWNLOAD_PAGE,
  OLRC_PRIOR_RELEASE_POINTS_PAGE,
  TokenBucket,
  buildCornellSectionUrl,
  buildCourtListenerSearchUrl,
  buildEcfrAuthoritySearchUrl,
  buildFederalRegisterSearchUrl,
  buildGovInfoSearchUrl,
  buildGovInfoSectionUrl,
  buildOlrcSectionUrl,
  isSafeHttpsUrl,
} from '@civic-source/shared';
import { collectFilesRecursive, scanFileForUrls } from './link-validation-offline.js';

export type LinkCheckStatus = 'ok' | 'warn_throttled' | 'fail';

export interface LiveProbeTarget {
  readonly url: string;
  readonly source: string;
  readonly kind: 'html' | 'binary' | 'api' | 'olrc_download' | 'olrc_prior';
}

export interface LiveProbeOutcome {
  readonly url: string;
  readonly source: string;
  readonly status: LinkCheckStatus;
  readonly httpStatus?: number;
  readonly finalUrl?: string;
  readonly reason: string;
  readonly elapsedMs: number;
}

export interface LiveValidationResult {
  readonly ok: boolean;
  readonly totalProbed: number;
  readonly okCount: number;
  readonly warnCount: number;
  readonly failCount: number;
  readonly olrcParserChecks: {
    readonly downloadTitles: number;
    readonly priorReleases: number;
    readonly currentPublicLaw: string;
  };
  readonly outcomes: readonly LiveProbeOutcome[];
}

export interface ProbeUrlOptions {
  fetchFn?: typeof fetch | undefined;
  buckets?: Map<string, TokenBucket> | undefined;
  retryDelayMs?: number | undefined;
}

const MAX_PROBE_BODY_BYTES = 4 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 15_000;
const USER_AGENT =
  'CivicSourceLinkValidator/1.0 (+https://github.com/civic-source/us-code-tracker)';

const CHALLENGE_WARN_HOSTS = new Set([
  'www.courtlistener.com',
  'courtlistener.com',
  'www.bestpractices.dev',
  'bestpractices.dev',
]);

const SOFT_404_HEADING_PATTERN =
  /(?:\b404\b\s*(?:not found|error|page|[-:|])|(?:http|error|status)\s*404\b|page not found|file not found|does not exist|page cannot be found)/i;

const SOFT_404_BODY_PHRASES: readonly string[] = [
  'the requested page does not exist',
  'the requested resource is not available',
  'the page you requested cannot be found',
  "sorry, we couldn't find that page",
  '404 - page not found',
];

/** Detect HTTP 200 "soft 404" error pages without false-positiving on § 404 or Part 404 headings. */
export function detectSoft404(body: string): boolean {
  if (!body) return false;
  const titleMatch = /<title>([^<]{0,200})<\/title>/i.exec(body);
  if (titleMatch?.[1] && SOFT_404_HEADING_PATTERN.test(titleMatch[1])) {
    return true;
  }
  const h1Match = /<h1\b[^>]{0,120}>([^<]{0,200})<\/h1>/i.exec(body);
  if (h1Match?.[1] && SOFT_404_HEADING_PATTERN.test(h1Match[1])) {
    return true;
  }
  const lower = body.toLowerCase();
  return SOFT_404_BODY_PHRASES.some((phrase) => lower.includes(phrase));
}

function getHostBucket(buckets: Map<string, TokenBucket>, url: string): TokenBucket {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = 'default';
  }
  const existing = buckets.get(host);
  if (existing) return existing;

  const isSensitive =
    host === 'www.ecfr.gov' ||
    host === 'ecfr.gov' ||
    host === 'www.courtlistener.com' ||
    host === 'courtlistener.com';
  const bucket = new TokenBucket({
    capacity: 1,
    refillRate: 1,
    refillIntervalMs: isSensitive ? 1500 : 300,
  });
  buckets.set(host, bucket);
  return bucket;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveFn) => setTimeout(resolveFn, ms));
}

function hostMatchesWarnSet(url: string): boolean {
  try {
    return CHALLENGE_WARN_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function cancelBodyQuietly(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
}

async function performRateLimitedFetch(
  url: string,
  method: 'HEAD' | 'GET',
  fetchFn: typeof fetch,
  buckets: Map<string, TokenBucket>
): Promise<Response> {
  const bucket = getHostBucket(buckets, url);
  await bucket.waitAndConsume(1);
  return fetchFn(url, {
    method,
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
}

async function fetchProbeWithFallback(
  target: LiveProbeTarget,
  fetchFn: typeof fetch,
  buckets: Map<string, TokenBucket>,
  retryDelayMs: number
): Promise<Response> {
  const initialMethod = target.kind === 'binary' ? 'HEAD' : 'GET';
  let response = await performRateLimitedFetch(target.url, initialMethod, fetchFn, buckets);

  if (initialMethod === 'HEAD' && [403, 405, 501].includes(response.status)) {
    await cancelBodyQuietly(response);
    response = await performRateLimitedFetch(target.url, 'GET', fetchFn, buckets);
  }

  if (response.status === 429 || response.status >= 500) {
    await cancelBodyQuietly(response);
    await sleep(retryDelayMs);
    response = await performRateLimitedFetch(
      target.url,
      initialMethod === 'HEAD' ? 'GET' : initialMethod,
      fetchFn,
      buckets
    );
  }

  return response;
}

function classifyNonOkResponse(
  target: LiveProbeTarget,
  response: Response,
  finalUrl: string,
  elapsedMs: number
): LiveProbeOutcome {
  if (response.status === 202 || response.status === 429) {
    return {
      url: target.url,
      source: target.source,
      status: 'warn_throttled',
      httpStatus: response.status,
      finalUrl,
      reason: `Upstream rate-limit / challenge HTTP ${response.status}`,
      elapsedMs,
    };
  }
  if (response.status === 403 && hostMatchesWarnSet(target.url)) {
    return {
      url: target.url,
      source: target.source,
      status: 'warn_throttled',
      httpStatus: response.status,
      finalUrl,
      reason: `Bot-protection HTTP 403 on ${new URL(target.url).hostname}`,
      elapsedMs,
    };
  }
  return {
    url: target.url,
    source: target.source,
    status: 'fail',
    httpStatus: response.status,
    finalUrl,
    reason: `HTTP ${response.status} ${response.statusText}`.trim(),
    elapsedMs,
  };
}

/** Probe a single target URL with HEAD->GET fallback, soft-404 detection, and polite retry. */
export async function probeUrl(
  target: LiveProbeTarget,
  options: ProbeUrlOptions = {}
): Promise<{ outcome: LiveProbeOutcome; body?: string }> {
  const fetchFn = options.fetchFn ?? fetch;
  const buckets = options.buckets ?? new Map<string, TokenBucket>();
  const retryDelayMs = options.retryDelayMs ?? 2500;
  const startMs = performance.now();

  try {
    const response = await fetchProbeWithFallback(target, fetchFn, buckets, retryDelayMs);
    const elapsedMs = Math.round(performance.now() - startMs);
    const finalUrl = response.url || target.url;

    if (!response.ok || response.status === 202) {
      await cancelBodyQuietly(response);
      return { outcome: classifyNonOkResponse(target, response, finalUrl, elapsedMs) };
    }

    if (target.kind === 'binary') {
      await cancelBodyQuietly(response);
      return {
        outcome: {
          url: target.url,
          source: target.source,
          status: 'ok',
          httpStatus: response.status,
          finalUrl,
          reason: `HTTP ${response.status}`,
          elapsedMs,
        },
      };
    }

    const body = await readBodyCapped(response, MAX_PROBE_BODY_BYTES);
    if (body === null) {
      return {
        outcome: {
          url: target.url,
          source: target.source,
          status: 'fail',
          httpStatus: response.status,
          finalUrl,
          reason: 'Response body exceeded size cap',
          elapsedMs,
        },
      };
    }

    const checksSoft404 =
      target.kind === 'html' || target.kind === 'olrc_download' || target.kind === 'olrc_prior';
    if (checksSoft404 && detectSoft404(body)) {
      return {
        outcome: {
          url: target.url,
          source: target.source,
          status: 'fail',
          httpStatus: response.status,
          finalUrl,
          reason: 'Soft-404 detected in HTTP 200 HTML response',
          elapsedMs,
        },
        body,
      };
    }

    return {
      outcome: {
        url: target.url,
        source: target.source,
        status: 'ok',
        httpStatus: response.status,
        finalUrl,
        reason: `HTTP ${response.status}`,
        elapsedMs,
      },
      body,
    };
  } catch (error: unknown) {
    return {
      outcome: {
        url: target.url,
        source: target.source,
        status: 'fail',
        reason: error instanceof Error ? error.message : String(error),
        elapsedMs: Math.round(performance.now() - startMs),
      },
    };
  }
}

function classifyUrlKind(url: string): LiveProbeTarget['kind'] {
  if (url === OLRC_DOWNLOAD_PAGE) return 'olrc_download';
  if (url === OLRC_PRIOR_RELEASE_POINTS_PAGE) return 'olrc_prior';
  if (/\.(?:zip|pdf|svg|png|jpe?g)(?:$|\?)/i.test(url)) return 'binary';
  if (url.includes('/api/')) return 'api';
  return 'html';
}

function pickEvenSample<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit) return [...items];
  const step = items.length / limit;
  const sampled: T[] = [];
  for (let i = 0; i < limit; i++) {
    const item = items[Math.floor(i * step)];
    if (item !== undefined) sampled.push(item);
  }
  return sampled;
}

function appendCoreAndBuiltTargets(
  add: (url: string, source: string, kindOverride?: LiveProbeTarget['kind']) => void
): void {
  add(OLRC_BROWSE_URL, 'olrc:browse');
  add(OLRC_DOWNLOAD_PAGE, 'olrc:download', 'olrc_download');
  add(OLRC_PRIOR_RELEASE_POINTS_PAGE, 'olrc:prior', 'olrc_prior');
  add(OLRC_CODIFICATION_URL, 'olrc:codification');
  add(OLRC_CLASSIFICATION_TABLES_URL, 'olrc:classification');

  const sampleStatutes: Array<[string | number, string, string]> = [
    [10, '135', 'sample:10/135'],
    [18, '1001', 'sample:18/1001'],
    [18, '175b', 'sample:18/175b'],
    [31, '3720B', 'sample:31/3720B'],
    [16, '470hh', 'sample:16/470hh'],
    [16, '460bbbb', 'sample:16/460bbbb'],
    [18, '281', 'sample:18/281-repealed'],
  ];

  for (const [title, section, label] of sampleStatutes) {
    add(buildOlrcSectionUrl(title, section), `olrc:${label}`);
    add(buildGovInfoSectionUrl(title, section), `govinfo:${label}`, 'binary');
    add(buildCornellSectionUrl(title, section), `cornell:${label}`);
  }
  add(buildOlrcSectionUrl(34, '11146'), 'olrc:sample:34/11146-repealed');

  for (const [title, section] of [[10, '135'], [18, '1001']] as const) {
    add(buildEcfrAuthoritySearchUrl(title, section), `ecfr-search:${title}/${section}`);
    add(buildFederalRegisterSearchUrl(title, section), `fr-search:${title}/${section}`);
    add(buildGovInfoSearchUrl(title, section), `govinfo-search:${title}/${section}`);
    add(
      buildCourtListenerSearchUrl(title, section, { exactSectionSymbol: true, opinionsOnly: true }),
      `courtlistener-search:${title}/${section}`
    );
  }
}

/** Build the bounded set of authoritative and representative live probe targets. */
async function buildLiveProbeTargets(rootDir: string): Promise<LiveProbeTarget[]> {
  const targets = new Map<string, LiveProbeTarget>();
  const add = (url: string, source: string, kindOverride?: LiveProbeTarget['kind']): void => {
    if (!isSafeHttpsUrl(url) || targets.has(url)) return;
    targets.set(url, { url, source, kind: kindOverride ?? classifyUrlKind(url) });
  };

  appendCoreAndBuiltTargets(add);

  const staticFiles: string[] = [];
  await collectFilesRecursive(join(rootDir, 'apps/web/public/context'), ['.json'], staticFiles);
  await collectFilesRecursive(join(rootDir, 'apps/web/public/topics'), ['.json'], staticFiles);
  const readmePath = join(rootDir, 'README.md');
  if (existsSync(readmePath)) staticFiles.push(readmePath);

  for (const file of staticFiles) {
    const rel = relative(rootDir, file);
    const scanned = await scanFileForUrls(file, rel);
    for (const url of scanned.externalUrls) add(url, rel);
  }

  await appendSampledSidecarTargets(rootDir, add);
  return Array.from(targets.values());
}

/** Sample representative sidecar URLs from content-data without bursting upstream rate limits. */
async function appendSampledSidecarTargets(
  rootDir: string,
  add: (url: string, source: string, kindOverride?: LiveProbeTarget['kind']) => void
): Promise<void> {
  const legFiles: string[] = [];
  await collectFilesRecursive(join(rootDir, 'apps/web/content-data/legislative'), ['.json'], legFiles);
  for (const f of legFiles) {
    const res = await scanFileForUrls(f, relative(rootDir, f));
    for (const url of res.externalUrls) add(url, relative(rootDir, f));
  }

  const regFiles: string[] = [];
  await collectFilesRecursive(join(rootDir, 'apps/web/content-data/regulations'), ['.json'], regFiles);
  const regUrls: Array<{ url: string; source: string }> = [];
  for (const f of regFiles.sort()) {
    const res = await scanFileForUrls(f, relative(rootDir, f));
    for (const url of res.externalUrls) regUrls.push({ url, source: relative(rootDir, f) });
  }
  for (const item of pickEvenSample(regUrls, 8)) {
    add(item.url, item.source);
  }

  const annFiles: string[] = [];
  await collectFilesRecursive(join(rootDir, 'apps/web/content-data/annotations'), ['.yaml', '.yml'], annFiles);
  for (const f of pickEvenSample(annFiles.sort(), 3)) {
    const res = await scanFileForUrls(f, relative(rootDir, f));
    if (res.externalUrls[0]) add(res.externalUrls[0], relative(rootDir, f));
  }
}

function runOlrcSmokeChecks(
  target: LiveProbeTarget,
  outcome: LiveProbeOutcome,
  body: string | undefined,
  state: { downloadTitles: number; priorReleases: number; currentPublicLaw: string }
): LiveProbeOutcome | null {
  if (outcome.status !== 'ok' || body === undefined) return null;

  if (target.kind === 'olrc_download') {
    const releases = parseReleasePoints(body);
    const current = parseCurrentRelease(body);
    state.downloadTitles = releases.length;
    state.currentPublicLaw = current?.publicLaw ?? '';
    if (releases.length < 50 || !current) {
      return {
        url: target.url,
        source: 'parser:olrc_download',
        status: 'fail',
        reason: `OLRC download parser smoke check failed (titles=${releases.length}, current=${state.currentPublicLaw || 'missing'})`,
        elapsedMs: 0,
      };
    }
  }

  if (target.kind === 'olrc_prior') {
    const prior = parsePriorReleasePoints(body);
    state.priorReleases = prior.length;
    if (prior.length < 10) {
      return {
        url: target.url,
        source: 'parser:olrc_prior',
        status: 'fail',
        reason: `OLRC prior release parser smoke check failed (count=${prior.length})`,
        elapsedMs: 0,
      };
    }
  }

  return null;
}

/** Run polite live external link verification plus OLRC release-page parser smoke checks. */
export async function runLiveLinkValidation(
  rootDir: string,
  options: { fetchFn?: typeof fetch | undefined; retryDelayMs?: number | undefined } = {}
): Promise<LiveValidationResult> {
  const targets = await buildLiveProbeTargets(rootDir);
  const buckets = new Map<string, TokenBucket>();
  const outcomes: LiveProbeOutcome[] = [];
  const parserState = { downloadTitles: 0, priorReleases: 0, currentPublicLaw: '' };

  for (const target of targets) {
    const { outcome, body } = await probeUrl(target, {
      fetchFn: options.fetchFn,
      buckets,
      retryDelayMs: options.retryDelayMs,
    });
    outcomes.push(outcome);

    const smokeFailure = runOlrcSmokeChecks(target, outcome, body, parserState);
    if (smokeFailure) {
      outcomes.push(smokeFailure);
    }
  }

  const okCount = outcomes.filter((o) => o.status === 'ok').length;
  const warnCount = outcomes.filter((o) => o.status === 'warn_throttled').length;
  const failCount = outcomes.filter((o) => o.status === 'fail').length;

  return {
    ok: failCount === 0,
    totalProbed: outcomes.length,
    okCount,
    warnCount,
    failCount,
    olrcParserChecks: parserState,
    outcomes,
  };
}

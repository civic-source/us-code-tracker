/**
 * Shared helpers for the historical import script:
 * state persistence, git operations, and ZIP download/extraction.
 */

import { writeFile, mkdir, readFile, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync } from 'node:fs';

import type { Logger } from '../../packages/shared/src/index.js';
import type { TokenBucket } from '../../packages/shared/src/index.js';

import { titleZipUrl, type ReleasePointId } from './release-points.js';

const execFileAsync = promisify(execFile);

const STATE_FILE = '.import-state.json';
const RATE_LIMIT_BACKOFF_MS = 30_000;

// --- Types ---

export interface ImportState {
  lastCompletedReleasePoint: string | null;
  manifests: Record<string, Record<string, string>>;
}

// --- State management ---

export async function loadState(repo: string): Promise<ImportState> {
  try {
    const raw = await readFile(join(repo, STATE_FILE), 'utf-8');
    return JSON.parse(raw) as ImportState;
  } catch {
    return { lastCompletedReleasePoint: null, manifests: {} };
  }
}

export async function saveState(repo: string, state: ImportState): Promise<void> {
  await writeFile(join(repo, STATE_FILE), JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

// --- Git operations ---

export async function gitCommit(repo: string, message: string): Promise<void> {
  // Batch git add by top-level title directories to avoid OOM on 50K+ files
  const statutesDir = join(repo, 'statutes');
  try {
    const entries = readdirSync(statutesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await execFileAsync('git', ['add', join('statutes', entry.name)], {
          cwd: repo,
          timeout: 60_000,
        });
      }
    }
  } catch {
    // Fallback to git add -A if statutes dir doesn't exist yet
    await execFileAsync('git', ['add', '-A'], { cwd: repo, timeout: 120_000 });
  }
  // Also add any root-level files (like .import-state.json)
  await execFileAsync('git', ['add', '-A'], { cwd: repo, timeout: 60_000 }).catch(() => {});
  await execFileAsync('git', ['commit', '-m', message, '--allow-empty'], {
    cwd: repo,
    timeout: 120_000,
  });
}

export async function gitTag(repo: string, tag: string): Promise<void> {
  try {
    await execFileAsync('git', ['tag', '-f', tag], { cwd: repo, timeout: 10_000 });
  } catch {
    // Tag creation is best-effort — don't fail the import
  }
}

// --- Download + extract ---

function findXmlFile(dir: string): string | null {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.xml')) return fullPath;
    if (entry.isDirectory()) {
      const found = findXmlFile(fullPath);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Returns true if a response body looks like the OLRC "document not found" redirect page.
 * OLRC returns HTTP 200 after a 302→docnotfound redirect for unavailable titles.
 */
async function isDocNotFound(response: Response): Promise<boolean> {
  // Check content-type — the not-found page is HTML, not a ZIP binary
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    return true;
  }
  return false;
}

/**
 * Outcome of a single title fetch+extract, distinguishing a title that is
 * legitimately *absent* at a release point from a *transient failure* (#236).
 * The two were previously collapsed to `null`, so a network blip looked
 * identical to "not published yet" and the resume cursor advanced past it,
 * permanently dropping the title's update from the historical record.
 */
export type TitleFetch =
  | { kind: 'ok'; xml: string }
  | { kind: 'absent' }
  | { kind: 'failed'; reason: string };

/** Internal outcome of the HTTP fetch, before ZIP extraction. */
type FetchOutcome =
  | { kind: 'response'; response: Response }
  | { kind: 'absent' }
  | { kind: 'failed'; reason: string };

async function fetchWithRateRetry(
  url: string,
  log: Logger,
  maxRetries = 3
): Promise<FetchOutcome> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      // 301/302 and 404 mean the title genuinely is not at this release point
      // (OLRC redirects unavailable titles); the doc-not-found HTML page too.
      if (response.status === 302 || response.status === 301) {
        return { kind: 'absent' };
      }
      if (response.status === 404) return { kind: 'absent' };
      if (response.status === 429) {
        log.warn('Rate limited, waiting 30s', { url, attempt });
        await new Promise<void>((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
        continue;
      }
      if (!response.ok) {
        log.warn('Download failed', { url, status: response.status, attempt });
        if (attempt < maxRetries) {
          await new Promise<void>((r) => setTimeout(r, 5000 * attempt));
          continue;
        }
        return { kind: 'failed', reason: `HTTP ${response.status} after ${maxRetries} attempts` };
      }
      if (await isDocNotFound(response)) {
        return { kind: 'absent' };
      }
      return { kind: 'response', response };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      log.warn('Network error, retrying', { url, attempt, error: msg });
      if (attempt < maxRetries) {
        await new Promise<void>((r) => setTimeout(r, 10000 * attempt));
        continue;
      }
      log.error('Network error after all retries', { url, attempts: maxRetries });
      return { kind: 'failed', reason: `network error after ${maxRetries} attempts: ${msg}` };
    }
  }
  // Loop fell through (e.g. 429 never cleared within maxRetries) — transient.
  return { kind: 'failed', reason: `rate-limited past ${maxRetries} attempts` };
}

export async function downloadAndExtractXml(
  rp: ReleasePointId,
  paddedTitle: string,
  rateLimiter: TokenBucket,
  log: Logger
): Promise<TitleFetch> {
  const url = titleZipUrl(rp, paddedTitle);
  // Random per-invocation temp dir under the OS temp root — no predictable
  // path, no symlink race.
  const workDir = await mkdtemp(join(tmpdir(), 'usc-hist-'));
  const tmpZip = join(workDir, 'download.zip');
  const tmpDir = join(workDir, 'extract');

  await rateLimiter.waitAndConsume();

  try {
    const outcome = await fetchWithRateRetry(url, log);
    if (outcome.kind === 'absent') {
      log.info('Title not available at release point', {
        title: parseInt(paddedTitle, 10),
        releasePoint: `PL ${rp.congress}-${rp.law}`,
      });
      return { kind: 'absent' };
    }
    if (outcome.kind === 'failed') {
      log.warn('Title fetch failed (transient)', {
        title: parseInt(paddedTitle, 10),
        releasePoint: `PL ${rp.congress}-${rp.law}`,
        reason: outcome.reason,
      });
      return { kind: 'failed', reason: outcome.reason };
    }

    const buf = Buffer.from(await outcome.response.arrayBuffer());
    // A present-but-corrupt archive is a failure (worth retrying / surfacing),
    // not a legitimate absence.
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      log.warn('Invalid ZIP', { url });
      return { kind: 'failed', reason: 'invalid ZIP (no PK signature)' };
    }

    await writeFile(tmpZip, buf);
    await mkdir(tmpDir, { recursive: true });
    await execFileAsync('unzip', ['-o', '-q', tmpZip, '-d', tmpDir], { timeout: 60_000 });

    const xmlPath = findXmlFile(tmpDir);
    if (!xmlPath) return { kind: 'failed', reason: 'no XML entry in archive' };

    return { kind: 'ok', xml: await readFile(xmlPath, 'utf-8') };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Exported for unit testing the absent-vs-failed classification.
export { fetchWithRateRetry as _fetchWithRateRetry };

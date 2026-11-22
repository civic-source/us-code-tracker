/**
 * Shared helpers for the historical import script (USCT-005 & USCT-006):
 * - Per-release and per-title checkpoint ledger so failed middle releases remain retryable
 *   even after later releases succeed (USCT-005).
 * - Immutable release tag protection without `git tag -f`: identical content is an idempotent
 *   no-op; differing content raises an explicit collision error or creates a revision tag
 *   with a supersession link (USCT-006).
 */

import { writeFile, mkdir, readFile, rm, mkdtemp, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

import type { Logger, TokenBucket } from '../../packages/shared/src/index.js';

import {
  titleZipUrl,
  releasePointKey,
  releasePointTagName,
  type ReleasePointId,
} from './release-points.js';

const execFileAsync = promisify(execFile);

const STATE_FILE = '.import-state.json';
const RATE_LIMIT_BACKOFF_MS = 30_000;

// --- Types (USCT-005 & USCT-006) ---

export type ReleaseLedgerStatus = 'complete' | 'partial' | 'failed';

export type TitleScopeOutcome = 'ok' | 'absent' | 'failed';

export interface ReleaseLedgerEntry {
  releaseKey: string;
  label: string;
  status: ReleaseLedgerStatus;
  tagName?: string;
  commitSha?: string;
  manifestHash?: string;
  revision?: number;
  supersedesTag?: string;
  titleOutcomes: Record<string, TitleScopeOutcome>;
  failedTitles: string[];
  updatedAt: string;
}

export interface SupersessionRecord {
  originalTag: string;
  originalCommitSha: string;
  originalManifestHash: string;
  revisionTag: string;
  revisionCommitSha: string;
  revisionManifestHash: string;
  reason: string;
  recordedAt: string;
}

export interface ImportState {
  lastCompletedReleasePoint: string | null;
  manifests: Record<string, Record<string, string>>;
  /** Per-release checkpoint ledger keyed by releaseKey (e.g. "119-73" or "119-73not60") (USCT-005) */
  releaseLedger?: Record<string, ReleaseLedgerEntry>;
  /** Explicit gap list of incomplete/failed release keys between completed releases (USCT-005) */
  incompleteReleases?: string[];
  /** Promotion & supersession log for immutable release corrections (USCT-006) */
  supersessions?: SupersessionRecord[];
}

/** Compute deterministic SHA-256 hash of a release's aggregate title->file->hash manifests */
export function computeReleaseManifestHash(
  manifests: Record<string, Record<string, string>>
): string {
  const sortedTitles = Object.keys(manifests).sort();
  const h = createHash('sha256');
  for (const title of sortedTitles) {
    const files = manifests[title] ?? {};
    const sortedPaths = Object.keys(files).sort();
    for (const p of sortedPaths) {
      h.update(`${title}:${p}:${files[p]}\n`);
    }
  }
  return h.digest('hex');
}

// --- State management ---

export async function loadState(repo: string): Promise<ImportState> {
  try {
    const raw = await readFile(join(repo, STATE_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as ImportState;
    return {
      lastCompletedReleasePoint: parsed.lastCompletedReleasePoint ?? null,
      manifests: parsed.manifests ?? {},
      releaseLedger: parsed.releaseLedger ?? {},
      incompleteReleases: parsed.incompleteReleases ?? [],
      supersessions: parsed.supersessions ?? [],
    };
  } catch {
    return {
      lastCompletedReleasePoint: null,
      manifests: {},
      releaseLedger: {},
      incompleteReleases: [],
      supersessions: [],
    };
  }
}

/**
 * Atomic state write via temp file + rename so an interrupted process
 * never leaves a half-written `.import-state.json` (USCT-005).
 */
export async function saveState(repo: string, state: ImportState): Promise<void> {
  const target = join(repo, STATE_FILE);
  const tmp = join(repo, `${STATE_FILE}.tmp.${process.pid}`);
  await writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  await rename(tmp, target);
}

/**
 * Determine whether a release point needs processing on `--resume` (USCT-005).
 *
 * A release point is skipped ONLY if:
 * 1. Its `releaseLedger[key]` entry is `'complete'` and every requested title in `requestedTitles`
 *    is accounted for (`'ok'` or `'absent'`), OR
 * 2. It has no ledger entry (legacy state) AND its release ordering is <= `lastCompletedReleasePoint`
 *    AND it is not listed in `incompleteReleases`.
 *
 * Crucially, if R1 succeeded, R2 failed/partially failed, and R3 succeeded, R2 has status `'partial'`/`'failed'`
 * in `releaseLedger`, so `shouldProcessReleaseOnResume` returns `true` for R2 and `false` for R1 and R3!
 */
export function shouldProcessReleaseOnResume(
  rp: ReleasePointId,
  state: ImportState,
  requestedTitles: readonly string[]
): boolean {
  const key = releasePointKey(rp);
  const ledgerEntry = state.releaseLedger?.[key];

  if (ledgerEntry) {
    if (ledgerEntry.status !== 'complete') return true;
    // Verify all requested titles were completed in that entry
    return requestedTitles.some((t) => {
      const outcome = ledgerEntry.titleOutcomes[t];
      return outcome !== 'ok' && outcome !== 'absent';
    });
  }

  if (state.incompleteReleases?.includes(key)) {
    return true;
  }

  if (state.lastCompletedReleasePoint) {
    const parts = state.lastCompletedReleasePoint.split('-');
    const lastC = parseInt(parts[0] ?? '0', 10);
    const lastL = parseInt(parts[1] ?? '0', 10);
    if (rp.congress < lastC || (rp.congress === lastC && rp.law <= lastL)) {
      return false;
    }
  }

  return true;
}

/**
 * Update the per-release checkpoint ledger and compute any historical gaps between completed releases (USCT-005).
 */
export function recordReleaseLedgerOutcome(
  state: ImportState,
  rp: ReleasePointId,
  titleOutcomes: Record<string, TitleScopeOutcome>,
  meta?: {
    tagName?: string | undefined;
    commitSha?: string | undefined;
    manifestHash?: string | undefined;
    revision?: number | undefined;
    supersedesTag?: string | undefined;
    nowIso?: string | undefined;
  }
): ReleaseLedgerEntry {
  if (!state.releaseLedger) state.releaseLedger = {};
  const key = releasePointKey(rp);
  const existing = state.releaseLedger[key];

  const mergedOutcomes: Record<string, TitleScopeOutcome> = {
    ...(existing?.titleOutcomes ?? {}),
    ...titleOutcomes,
  };

  const failedTitles = Object.entries(mergedOutcomes)
    .filter(([, outcome]) => outcome === 'failed')
    .map(([title]) => title)
    .sort();

  const completedCount = Object.values(mergedOutcomes).filter(
    (o) => o === 'ok' || o === 'absent'
  ).length;

  const status: ReleaseLedgerStatus =
    failedTitles.length === 0
      ? 'complete'
      : completedCount > 0
        ? 'partial'
        : 'failed';

  const entry: ReleaseLedgerEntry = {
    releaseKey: key,
    label: rp.label,
    status,
    ...(meta?.tagName ?? existing?.tagName ? { tagName: meta?.tagName ?? existing?.tagName } : {}),
    ...(meta?.commitSha ?? existing?.commitSha ? { commitSha: meta?.commitSha ?? existing?.commitSha } : {}),
    ...(meta?.manifestHash ?? existing?.manifestHash
      ? { manifestHash: meta?.manifestHash ?? existing?.manifestHash }
      : {}),
    ...(meta?.revision ?? existing?.revision ? { revision: meta?.revision ?? existing?.revision } : {}),
    ...(meta?.supersedesTag ?? existing?.supersedesTag
      ? { supersedesTag: meta?.supersedesTag ?? existing?.supersedesTag }
      : {}),
    titleOutcomes: mergedOutcomes,
    failedTitles,
    updatedAt: meta?.nowIso ?? new Date().toISOString(),
  };

  state.releaseLedger[key] = entry;

  // Recompute incompleteReleases list
  state.incompleteReleases = Object.values(state.releaseLedger)
    .filter((e) => e.status !== 'complete')
    .map((e) => e.releaseKey)
    .sort();

  // Only advance legacy lastCompletedReleasePoint when there are zero incomplete releases prior to this release
  if (status === 'complete' && state.incompleteReleases.length === 0) {
    state.lastCompletedReleasePoint = key;
  }

  return entry;
}

// --- Git operations & Immutable Release Tagging (USCT-006) ---

export async function gitRevParse(repo: string, ref: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
      cwd: repo,
      timeout: 10_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function gitTreeHash(repo: string, ref: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', `${ref}^{tree}`], {
      cwd: repo,
      timeout: 10_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function gitCommit(repo: string, message: string): Promise<string> {
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
    await execFileAsync('git', ['add', '-A'], { cwd: repo, timeout: 120_000 });
  }
  await execFileAsync('git', ['add', '-A'], { cwd: repo, timeout: 60_000 }).catch(() => {});
  await execFileAsync('git', ['commit', '-m', message, '--allow-empty'], {
    cwd: repo,
    timeout: 120_000,
  });
  const sha = await gitRevParse(repo, 'HEAD');
  return sha ?? '';
}

export type TagPublicationResult =
  | { kind: 'created'; tagName: string; commitSha: string; revision: number }
  | { kind: 'noop_identical'; tagName: string; commitSha: string; revision: number }
  | {
      kind: 'superseded_revision';
      tagName: string;
      commitSha: string;
      revision: number;
      supersedesTag: string;
      originalCommitSha: string;
    }
  | {
      kind: 'collision_error';
      tagName: string;
      existingCommitSha: string;
      newCommitSha: string;
      message: string;
    };

/**
 * Immutable release tag publication (USCT-006):
 * - Never executes `git tag -f`!
 * - If `tag` does not exist: creates `tag` pointing to `HEAD`.
 * - If `tag` already exists and has the exact same Git tree hash (or manifestHash): idempotent no-op.
 * - If `tag` already exists with different content:
 *   - By default (`allowCorrectionRevision === false`), returns `collision_error` without modifying the tag.
 *   - When `allowCorrectionRevision === true`, leaves the original `tag` immutable, allocates the next
 *     available `<tag>-rev<N>` tag, and records a supersession link in `state.supersessions`.
 */
export async function publishImmutableReleaseTag(
  repo: string,
  rp: ReleasePointId,
  options?: {
    state?: ImportState | undefined;
    manifestHash?: string | undefined;
    allowCorrectionRevision?: boolean | undefined;
    correctionReason?: string | undefined;
    nowIso?: string | undefined;
  }
): Promise<TagPublicationResult> {
  const baseTag = releasePointTagName(rp, 1);
  const headCommit = (await gitRevParse(repo, 'HEAD')) ?? '';
  const headTree = (await gitTreeHash(repo, 'HEAD')) ?? '';

  const existingCommit = await gitRevParse(repo, baseTag);
  if (!existingCommit) {
    // Create immutable tag (no -f flag)
    await execFileAsync('git', ['tag', baseTag], { cwd: repo, timeout: 10_000 });
    return { kind: 'created', tagName: baseTag, commitSha: headCommit, revision: 1 };
  }

  const existingTree = await gitTreeHash(repo, baseTag);
  const key = releasePointKey(rp);
  const recordedManifestHash = options?.state?.releaseLedger?.[key]?.manifestHash;
  const isIdentical =
    existingCommit === headCommit ||
    (existingTree !== null && existingTree === headTree) ||
    (options?.manifestHash !== undefined &&
      recordedManifestHash !== undefined &&
      options.manifestHash === recordedManifestHash);

  if (isIdentical) {
    return { kind: 'noop_identical', tagName: baseTag, commitSha: existingCommit, revision: 1 };
  }

  if (!options?.allowCorrectionRevision) {
    return {
      kind: 'collision_error',
      tagName: baseTag,
      existingCommitSha: existingCommit,
      newCommitSha: headCommit,
      message: `Immutable release tag collision: '${baseTag}' already points to ${existingCommit} (tree ${existingTree ?? 'unknown'}), refusing to overwrite with ${headCommit} (tree ${headTree})`,
    };
  }

  // Allocate next available -revN tag while keeping baseTag and earlier revisions untouched
  let rev = 2;
  let revTag = releasePointTagName(rp, rev);
  while ((await gitRevParse(repo, revTag)) !== null) {
    rev++;
    revTag = releasePointTagName(rp, rev);
  }

  await execFileAsync('git', ['tag', revTag], { cwd: repo, timeout: 10_000 });

  if (options.state) {
    if (!options.state.supersessions) options.state.supersessions = [];
    options.state.supersessions.push({
      originalTag: baseTag,
      originalCommitSha: existingCommit,
      originalManifestHash: recordedManifestHash ?? existingTree ?? '',
      revisionTag: revTag,
      revisionCommitSha: headCommit,
      revisionManifestHash: options.manifestHash ?? headTree,
      reason: options.correctionReason ?? 'Correction revision for existing published release identity',
      recordedAt: options.nowIso ?? new Date().toISOString(),
    });
  }

  return {
    kind: 'superseded_revision',
    tagName: revTag,
    commitSha: headCommit,
    revision: rev,
    supersedesTag: baseTag,
    originalCommitSha: existingCommit,
  };
}

/**
 * Legacy wrapper around immutable tag creation (never uses `-f`).
 * Throws if a tag collision with differing content occurs.
 */
export async function gitTag(repo: string, tag: string): Promise<void> {
  const existingCommit = await gitRevParse(repo, tag);
  if (existingCommit) {
    const existingTree = await gitTreeHash(repo, tag);
    const headTree = await gitTreeHash(repo, 'HEAD');
    if (existingTree && headTree && existingTree === headTree) {
      return; // Idempotent no-op
    }
    throw new Error(
      `Immutable release tag collision: '${tag}' already exists at ${existingCommit} with differing content`
    );
  }
  await execFileAsync('git', ['tag', tag], { cwd: repo, timeout: 10_000 });
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

async function isDocNotFound(response: Response): Promise<boolean> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    return true;
  }
  return false;
}

export type TitleFetch =
  | { kind: 'ok'; xml: string }
  | { kind: 'absent' }
  | { kind: 'failed'; reason: string };

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
  return { kind: 'failed', reason: `rate-limited past ${maxRetries} attempts` };
}

export async function downloadAndExtractXml(
  rp: ReleasePointId,
  paddedTitle: string,
  rateLimiter: TokenBucket,
  log: Logger
): Promise<TitleFetch> {
  const url = titleZipUrl(rp, paddedTitle);
  const workDir = await mkdtemp(join(tmpdir(), 'usc-hist-'));
  const tmpZip = join(workDir, 'download.zip');
  const tmpDir = join(workDir, 'extract');

  await rateLimiter.waitAndConsume();

  try {
    const outcome = await fetchWithRateRetry(url, log);
    if (outcome.kind === 'absent') {
      log.info('Title not available at release point', {
        title: parseInt(paddedTitle, 10),
        releasePoint: rp.label,
      });
      return { kind: 'absent' };
    }
    if (outcome.kind === 'failed') {
      log.warn('Title fetch failed (transient)', {
        title: parseInt(paddedTitle, 10),
        releasePoint: rp.label,
        reason: outcome.reason,
      });
      return { kind: 'failed', reason: outcome.reason };
    }

    const buf = Buffer.from(await outcome.response.arrayBuffer());
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

export { fetchWithRateRetry as _fetchWithRateRetry };

#!/usr/bin/env npx tsx
/**
 * Import historical OLRC release points as git commits (delta-only).
 *
 * USCT-005 & USCT-006:
 * - Tracks completion per exact release point and title in `state.releaseLedger`
 *   so an earlier failed release R2 remains retryable on `--resume` even after R3 succeeds.
 * - Stages and validates all titles in a release BEFORE committing and tagging;
 *   never commits or tags an incomplete release point.
 * - Uses immutable release tagging (`publishImmutableReleaseTag`) without `git tag -f`.
 */

import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseArgs } from 'node:util';

import { createLogger, TokenBucket } from '../packages/shared/src/index.js';
import { XmlToMarkdownAdapter } from '../packages/transformer/src/index.js';
import type { MarkdownFile } from '../packages/transformer/src/index.js';

import { buildManifest, detectDelta } from './lib/delta-detector.js';
import {
  scrapeReleasePoints,
  filterRange,
  parseReleasePointStr,
  releasePointKey,
  releasePointTagName,
  type ReleasePointId,
} from './lib/release-points.js';
import {
  loadState,
  saveState,
  gitCommit,
  publishImmutableReleaseTag,
  downloadAndExtractXml,
  shouldProcessReleaseOnResume,
  recordReleaseLedgerOutcome,
  computeReleaseManifestHash,
  type ImportState,
  type TitleScopeOutcome,
} from './lib/import-helpers.js';

const log = createLogger('import-history');

// --- Progress file ---

interface ImportProgress {
  currentReleasePoint: string;
  totalProcessed: number;
  totalRemaining: number;
  sectionsChangedTotal: number;
  peakMemoryMB: number;
  elapsedSeconds: number;
  estimatedRemainingSeconds: number | null;
}

async function writeProgress(
  repoPath: string,
  progress: ImportProgress
): Promise<void> {
  await writeFile(
    join(repoPath, '.import-progress.json'),
    JSON.stringify(progress, null, 2) + '\n',
    'utf-8'
  );
}

// --- Constants ---

const ALL_TITLES = Array.from({ length: 54 }, (_, i) => (i + 1).toString().padStart(2, '0'));
const MAX_CONCURRENT = 5;
const INTER_TITLE_DELAY_MS = 1000;

export interface ImportMetrics {
  releasePointsProcessed: number;
  titlesChanged: number;
  sectionsChanged: number;
  startTime: number;
}

export interface StagedTitleUpdate {
  paddedTitle: string;
  outcome: TitleScopeOutcome;
  allFiles: MarkdownFile[];
  changedFiles: MarkdownFile[];
  deletedPaths: string[];
  newManifest?: Record<string, string>;
}

/**
 * Fetch and transform a batch of titles into memory without mutating disk or state yet,
 * so a release point can be accepted or rejected transactionally (USCT-005).
 */
export async function stageBatch(
  batch: string[],
  rp: ReleasePointId,
  state: ImportState,
  rateLimiter: TokenBucket,
  fetcherFn: typeof downloadAndExtractXml = downloadAndExtractXml
): Promise<StagedTitleUpdate[]> {
  const fetchedResults = await Promise.all(
    batch.map(async (paddedTitle) => {
      const fetched = await fetcherFn(rp, paddedTitle, rateLimiter, log);
      if (fetched.kind === 'failed') {
        return { paddedTitle, outcome: 'failed' as const, files: [] as MarkdownFile[] };
      }
      if (fetched.kind === 'absent') {
        return { paddedTitle, outcome: 'absent' as const, files: [] as MarkdownFile[] };
      }

      const transformer = new XmlToMarkdownAdapter(rp.label);
      const result = transformer.transformToFiles(fetched.xml);
      if (!result.ok) {
        log.warn('Transform failed', { title: paddedTitle, error: result.error.message });
        return { paddedTitle, outcome: 'failed' as const, files: [] as MarkdownFile[] };
      }
      return { paddedTitle, outcome: 'ok' as const, files: result.value };
    })
  );

  const staged: StagedTitleUpdate[] = [];
  for (const { paddedTitle, outcome, files } of fetchedResults) {
    if (outcome !== 'ok' || files.length === 0) {
      staged.push({
        paddedTitle,
        outcome,
        allFiles: [],
        changedFiles: [],
        deletedPaths: [],
      });
      continue;
    }

    const currentManifest = buildManifest(files);
    const previousRaw = state.manifests[paddedTitle];
    const previousManifest = new Map<string, string>(
      previousRaw ? Object.entries(previousRaw) : []
    );
    const delta = detectDelta(previousManifest, currentManifest);

    const manifestObj: Record<string, string> = {};
    for (const [k, v] of currentManifest) {
      manifestObj[k] = v;
    }

    if (delta.changed.length === 0 && delta.deleted.length === 0) {
      staged.push({
        paddedTitle,
        outcome: 'ok',
        allFiles: files,
        changedFiles: [],
        deletedPaths: [],
        newManifest: manifestObj,
      });
      continue;
    }

    const changedSet = new Set(delta.changed);
    const changedFiles = files.filter((f) => changedSet.has(f.path));

    staged.push({
      paddedTitle,
      outcome: 'ok',
      allFiles: files,
      changedFiles,
      deletedPaths: delta.deleted,
      newManifest: manifestObj,
    });
  }

  return staged;
}

/**
 * Process a single release point with transactional completeness (USCT-005)
 * and immutable release tagging (USCT-006).
 */
export async function processReleasePoint(
  rp: ReleasePointId,
  state: ImportState,
  rateLimiter: TokenBucket,
  metrics: ImportMetrics,
  totalPoints: number,
  options: {
    repoPath: string;
    titlesToProcess: string[];
    dryRun: boolean;
    allowCorrectionRevision?: boolean;
    fetcherFn?: typeof downloadAndExtractXml;
    interTitleDelayMs?: number;
  }
): Promise<{ failedTitles: number; collisionError?: string }> {
  const {
    repoPath,
    titlesToProcess,
    dryRun,
    allowCorrectionRevision = false,
    fetcherFn = downloadAndExtractXml,
    interTitleDelayMs = INTER_TITLE_DELAY_MS,
  } = options;

  log.info('Processing release point', { label: rp.label, key: releasePointKey(rp) });

  const key = releasePointKey(rp);
  const existingLedger = state.releaseLedger?.[key];
  const stagingDir = join(repoPath, '.import-staging', key);

  // Load any previously retained staged title snapshots for this release (AUD-001 / USCT-005)
  const retainedStaged = new Map<string, StagedTitleUpdate>();
  for (const t of titlesToProcess) {
    const prior = existingLedger?.titleOutcomes[t];
    const cacheFile = join(stagingDir, `${t}.json`);
    if (prior === 'ok' && existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(await readFile(cacheFile, 'utf-8')) as {
          paddedTitle: string;
          allFiles: MarkdownFile[];
          newManifest: Record<string, string>;
        };
        const currentManifest = buildManifest(cached.allFiles);
        const previousRaw = state.manifests[t];
        const previousManifest = new Map<string, string>(
          previousRaw ? Object.entries(previousRaw) : []
        );
        const delta = detectDelta(previousManifest, currentManifest);
        const changedSet = new Set(delta.changed);
        retainedStaged.set(t, {
          paddedTitle: t,
          outcome: 'ok',
          allFiles: cached.allFiles,
          changedFiles: cached.allFiles.filter((f) => changedSet.has(f.path)),
          deletedPaths: delta.deleted,
          newManifest: cached.newManifest,
        });
      } catch {
        // Corrupted cache file; will re-fetch below
      }
    } else if (prior === 'absent') {
      retainedStaged.set(t, {
        paddedTitle: t,
        outcome: 'absent',
        allFiles: [],
        changedFiles: [],
        deletedPaths: [],
      });
    }
  }

  // Fetch every title not already retained with verified bytes for this release
  const titlesNeeded = titlesToProcess.filter((t) => !retainedStaged.has(t));

  const freshlyStaged: StagedTitleUpdate[] = [];
  for (let i = 0; i < titlesNeeded.length; i += MAX_CONCURRENT) {
    const batch = titlesNeeded.slice(i, i + MAX_CONCURRENT);
    const stagedBatch = await stageBatch(batch, rp, state, rateLimiter, fetcherFn);
    freshlyStaged.push(...stagedBatch);

    if (i + MAX_CONCURRENT < titlesNeeded.length && interTitleDelayMs > 0) {
      await new Promise<void>((r) => setTimeout(r, interTitleDelayMs));
    }
  }

  const allStaged: StagedTitleUpdate[] = [
    ...retainedStaged.values(),
    ...freshlyStaged,
  ];

  const titleOutcomes: Record<string, TitleScopeOutcome> = {};
  let failedTitles = 0;
  let totalChanged = 0;
  let totalTitlesChanged = 0;

  for (const s of allStaged) {
    titleOutcomes[s.paddedTitle] = s.outcome;
    if (s.outcome === 'failed') {
      failedTitles++;
    } else if (s.changedFiles.length > 0 || s.deletedPaths.length > 0) {
      totalTitlesChanged++;
      totalChanged += s.changedFiles.length;
    }
  }

  // USCT-005 & AUD-001: If ANY title failed at this release point, DO NOT write partial files to statutes/
  // or create a release tag! Persist successful titles' bytes in `.import-staging/<key>/` so resuming R2
  // reconstructs the complete R2 tree even after a later release R3 has modified the working tree.
  if (failedTitles > 0) {
    log.error('Release point had failed titles; staging aborted and release remains retryable', {
      label: rp.label,
      failedTitles,
    });
    if (!dryRun) {
      for (const s of freshlyStaged) {
        if (s.outcome === 'ok' && s.allFiles.length > 0 && s.newManifest) {
          await mkdir(stagingDir, { recursive: true });
          await writeFile(
            join(stagingDir, `${s.paddedTitle}.json`),
            JSON.stringify({
              paddedTitle: s.paddedTitle,
              allFiles: s.allFiles,
              newManifest: s.newManifest,
            }),
            'utf-8'
          );
        }
      }
    }
    recordReleaseLedgerOutcome(state, rp, titleOutcomes);
    if (!dryRun) {
      await saveState(repoPath, state);
    }
    return { failedTitles };
  }

  // All requested titles succeeded or were legitimately absent:
  // Clean up the staging directory for THIS completed release only (preserving any other incomplete release's staging cache!)
  if (!dryRun) {
    await rm(stagingDir, { recursive: true, force: true });
  }

  // Apply ALL files for every title in this release so resuming an earlier release R2 after R3
  // never leaves R3 bytes in R2's committed tree (AUD-001)
  for (const s of allStaged) {
    if (s.outcome === 'ok' && s.newManifest) {
      const priorPaths = Object.keys(state.manifests[s.paddedTitle] ?? {});
      const newPathSet = new Set(s.allFiles.map((f) => f.path));
      state.manifests[s.paddedTitle] = s.newManifest;
      if (!dryRun) {
        for (const file of s.allFiles) {
          const fullPath = join(repoPath, file.path);
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, file.content, 'utf-8');
        }
        for (const p of [...s.deletedPaths, ...priorPaths.filter((oldP) => !newPathSet.has(oldP))]) {
          await rm(join(repoPath, p), { force: true });
        }
      }
    } else if (s.outcome === 'absent') {
      const priorPaths = Object.keys(state.manifests[s.paddedTitle] ?? {});
      delete state.manifests[s.paddedTitle];
      if (!dryRun) {
        for (const p of priorPaths) {
          await rm(join(repoPath, p), { force: true });
        }
      }
    }
  }

  const manifestHash = computeReleaseManifestHash(state.manifests);
  let tagName = releasePointTagName(rp, 1);
  let commitSha = '';
  let revision = 1;
  let supersedesTag: string | undefined;

  if (totalChanged > 0 || totalTitlesChanged > 0) {
    const commitMsg = `chore(law): Update to ${rp.label}`;
    if (dryRun) {
      log.info('Dry run: would commit', { message: commitMsg, tag: tagName });
    } else {
      await gitCommit(repoPath, commitMsg);
      const tagRes = await publishImmutableReleaseTag(repoPath, rp, {
        state,
        manifestHash,
        allowCorrectionRevision,
      });

      if (tagRes.kind === 'collision_error') {
        log.error('Immutable release identity collision', {
          tag: tagRes.tagName,
          message: tagRes.message,
        });
        return { failedTitles: 1, collisionError: tagRes.message };
      }

      tagName = tagRes.tagName;
      commitSha = tagRes.commitSha;
      revision = tagRes.revision;
      if (tagRes.kind === 'superseded_revision') {
        supersedesTag = tagRes.supersedesTag;
      }
      log.info('Committed and published immutable release tag', {
        message: commitMsg,
        tag: tagName,
        kind: tagRes.kind,
      });
    }
  } else if (!dryRun) {
    // Even if a release point had 0 changed files relative to the current tree, ensure it receives
    // its immutable release tag on the current tree so the ledger's tagName is valid (AUD-001).
    const tagRes = await publishImmutableReleaseTag(repoPath, rp, {
      state,
      manifestHash,
      allowCorrectionRevision,
    });
    if (tagRes.kind === 'collision_error') {
      return { failedTitles: 1, collisionError: tagRes.message };
    }
    tagName = tagRes.tagName;
    commitSha = tagRes.commitSha;
    revision = tagRes.revision;
    log.info('Tagged release point with no text changes', { label: rp.label, tag: tagName });
  } else {
    log.info('No changes for release point', { label: rp.label });
  }

  recordReleaseLedgerOutcome(state, rp, titleOutcomes, {
    tagName,
    commitSha,
    manifestHash,
    revision,
    supersedesTag,
  });

  if (!dryRun) {
    await saveState(repoPath, state);
  }

  metrics.releasePointsProcessed++;
  metrics.titlesChanged += totalTitlesChanged;
  metrics.sectionsChanged += totalChanged;

  if (!dryRun) {
    const elapsed = (performance.now() - metrics.startTime) / 1000;
    const avgPerRp =
      metrics.releasePointsProcessed > 0 ? elapsed / metrics.releasePointsProcessed : 0;
    const memUsage = process.memoryUsage();
    const peakMB = Math.round(memUsage.rss / 1024 / 1024);
    await writeProgress(repoPath, {
      currentReleasePoint: rp.label,
      totalProcessed: metrics.releasePointsProcessed,
      totalRemaining: totalPoints - metrics.releasePointsProcessed,
      sectionsChangedTotal: metrics.sectionsChanged,
      peakMemoryMB: peakMB,
      elapsedSeconds: Math.round(elapsed),
      estimatedRemainingSeconds:
        avgPerRp > 0 ? Math.round(avgPerRp * (totalPoints - metrics.releasePointsProcessed)) : null,
    });
  }

  return { failedTitles: 0 };
}

// --- CLI Entry Point ---

async function main(): Promise<void> {
  const { values: args } = parseArgs({
    options: {
      repo: { type: 'string', short: 'r' },
      start: { type: 'string' },
      end: { type: 'string' },
      title: { type: 'string', short: 't' },
      'dry-run': { type: 'boolean', default: false },
      resume: { type: 'boolean', default: false },
      'allow-correction-revision': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (args.help || !args.repo) {
    const msg = `
Usage: npx tsx scripts/import-history.ts --repo <path> [options]

Options:
  --repo, -r                   Path to the us-code git repository (required)
  --start                      Start release point, e.g. pl/119/1 (inclusive)
  --end                        End release point, e.g. pl/119/73 (inclusive)
  --title, -t                  Process only this title number (e.g. 18)
  --dry-run                    Show what would change without committing
  --resume                     Resume and retry any incomplete/failed release points
  --allow-correction-revision  Create a -revN superseding tag instead of failing on tag collision
  --help, -h                   Show this help message
`;
    process.stdout.write(msg + '\n');
    process.exit(args.help ? 0 : 1);
  }

  const repoPath = args.repo;
  const dryRun = args['dry-run'] ?? false;
  const allowCorrectionRevision = args['allow-correction-revision'] ?? false;
  const titleFilter = args.title?.padStart(2, '0');
  const titlesToProcess = titleFilter ? [titleFilter] : ALL_TITLES;

  const metrics: ImportMetrics = {
    releasePointsProcessed: 0,
    titlesChanged: 0,
    sectionsChanged: 0,
    startTime: performance.now(),
  };

  const rateLimiter = new TokenBucket({
    capacity: MAX_CONCURRENT,
    refillRate: 1,
    refillIntervalMs: INTER_TITLE_DELAY_MS,
  });

  log.info('Scraping OLRC release points index');
  const allPoints = await scrapeReleasePoints();
  log.info('Found release points', { count: allPoints.length });

  const startRp = args.start ? parseReleasePointStr(args.start) : undefined;
  const endRp = args.end ? parseReleasePointStr(args.end) : undefined;

  if (args.start && !startRp) {
    log.error('Invalid --start format, expected pl/{congress}/{law}', { value: args.start });
    process.exit(1);
  }
  if (args.end && !endRp) {
    log.error('Invalid --end format, expected pl/{congress}/{law}', { value: args.end });
    process.exit(1);
  }

  let points = filterRange(allPoints, startRp ?? undefined, endRp ?? undefined);
  const state = await loadState(repoPath);

  if (args.resume) {
    const before = points.length;
    points = points.filter((p) => shouldProcessReleaseOnResume(p, state, titlesToProcess));
    log.info('Resuming historical import via release ledger', {
      totalInRange: before,
      toProcessOrRetry: points.length,
      skippedComplete: before - points.length,
      incompleteGaps: state.incompleteReleases ?? [],
    });
  }

  log.info('Processing release points', {
    total: points.length,
    dryRun,
    titleFilter: titleFilter ? parseInt(titleFilter, 10) : 'all',
  });

  let releasePointsWithFailures = 0;
  for (const rp of points) {
    try {
      const { failedTitles } = await processReleasePoint(rp, state, rateLimiter, metrics, points.length, {
        repoPath,
        titlesToProcess,
        dryRun,
        allowCorrectionRevision,
      });
      if (failedTitles > 0) releasePointsWithFailures++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('Release point failed, continuing to next (recorded as failed in ledger)', {
        label: rp.label,
        error: msg,
      });
      const failedOutcomes: Record<string, TitleScopeOutcome> = {};
      for (const t of titlesToProcess) failedOutcomes[t] = 'failed';
      recordReleaseLedgerOutcome(state, rp, failedOutcomes);
      if (!dryRun) await saveState(repoPath, state);
      releasePointsWithFailures++;
    }
  }

  const elapsed = (performance.now() - metrics.startTime) / 1000;
  log.info('Import complete', {
    releasePointsProcessed: metrics.releasePointsProcessed,
    titlesChanged: metrics.titlesChanged,
    sectionsChanged: metrics.sectionsChanged,
    releasePointsWithFailures,
    incompleteReleases: state.incompleteReleases ?? [],
    elapsedSeconds: Math.round(elapsed),
    dryRun,
  });

  if (releasePointsWithFailures > 0 || (state.incompleteReleases?.length ?? 0) > 0) {
    log.error('Import finished with unrecovered failures or gaps; rerun with --resume to retry', {
      releasePointsWithFailures,
      incompleteReleases: state.incompleteReleases,
    });
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('import-history.ts')) {
  main().catch((error: unknown) => {
    log.error('Fatal error', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}

#!/usr/bin/env npx tsx
/**
 * Sync newly released OLRC Public Laws into `civic-source/us-code`,
 * annotate only newly added or modified statute sections (bounded by
 * `--max-annotations`), and emit structured step outputs for `sync-law.yml`.
 */

import { execFile } from 'node:child_process';
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs, promisify } from 'node:util';

import { err, ok, type Result } from '../packages/types/src/index.js';
import { TokenBucket, createLogger } from '../packages/shared/src/index.js';
import { Annotator, annotationToYaml } from '../packages/annotator/src/index.js';
import { processReleasePoint, type ImportMetrics } from './import-history.js';
import { downloadAndExtractXml, loadState, shouldProcessReleaseOnResume, type ImportState } from './lib/import-helpers.js';
import { compareReleasePoints, parseReleasePointStr, releasePointKey, releasePointTagName, scrapeReleasePoints, type ReleasePointId } from './lib/release-points.js';

const execFileAsync = promisify(execFile);
const log = createLogger('sync-latest-release');

const ALL_TITLES = Array.from({ length: 54 }, (_, i) => (i + 1).toString().padStart(2, '0'));
const MAX_CONCURRENT_TITLES = 5;
const GIT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;
const FRONTMATTER_NOISE_REGEX = '^(current_through|generated_at|classification):';
const DEFAULT_MAX_ANNOTATIONS = 50;

export interface ChangedSectionRef {
  path: string;
  title: string;
  section: string;
  citation: string;
}

export interface SyncRunSummary {
  hasChanges: boolean;
  dryRun: boolean;
  latestReleaseLabel: string;
  latestReleaseSlug: string;
  pendingReleaseLabels: string[];
  pendingReleaseTags: string[];
  createdTags: string[];
  dataSha: string;
  sectionsChangedCount: number;
  annotatedCount: number;
  annotationFailures: number;
}

export interface SyncLatestOptions {
  repoPath: string;
  dryRun?: boolean | undefined;
  skipAnnotations?: boolean | undefined;
  maxAnnotations?: number | undefined;
  scrapeFn?: (() => Promise<ReleasePointId[]>) | undefined;
  fetcherFn?: typeof downloadAndExtractXml | undefined;
  annotateFn?: ((citation: string) => Promise<Result<{ path: string; yaml: string }>>) | undefined;
  interTitleDelayMs?: number | undefined;
}

async function gitExec(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 60_000, maxBuffer: GIT_MAX_BUFFER_BYTES });
  return stdout.trim();
}

function parseStateBaselineRp(raw: string | null): ReleasePointId | null {
  if (!raw) return null;
  const normalized = raw.startsWith('pl/') ? raw : `pl/${raw.replace(/^pl-/, '').replace('-', '/')}`;
  return parseReleasePointStr(normalized);
}

/** List existing `pl-*` release tags reachable from HEAD in the data repository. */
export async function listPublishedReleaseTags(repoPath: string): Promise<Set<string>> {
  const out = await gitExec(repoPath, ['tag', '--merged', 'HEAD', '--list', 'pl-*']).catch(() => '');
  return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
}

/**
 * Determine pending OLRC releases relative to `.import-state.json` and existing `pl-*` tags.
 * Retains explicitly incomplete releases so resume retries remain intact.
 */
export function resolvePendingReleases(
  allPoints: readonly ReleasePointId[],
  state: ImportState,
  existingTags: ReadonlySet<string>
): ReleasePointId[] {
  let highestTagged = parseStateBaselineRp(state.lastCompletedReleasePoint);
  for (const tag of existingTags) {
    const baseTag = tag.replace(/-rev\d+$/, '');
    const parsed = parseReleasePointStr(`pl/${baseTag.slice(3).replace(/-/g, '/')}`);
    if (parsed && (!highestTagged || compareReleasePoints(parsed, highestTagged) > 0)) {
      highestTagged = parsed;
    }
  }

  const incompleteSet = new Set(state.incompleteReleases ?? []);
  return allPoints.filter((rp) => {
    const key = releasePointKey(rp);
    const ledgerStatus = state.releaseLedger?.[key]?.status;
    if (incompleteSet.has(key) || (ledgerStatus && ledgerStatus !== 'complete')) return true;
    if (existingTags.has(releasePointTagName(rp, 1))) return false;
    if (highestTagged && compareReleasePoints(rp, highestTagged) <= 0) return false;
    return shouldProcessReleaseOnResume(rp, state, ALL_TITLES);
  });
}

/** Extract unique changed section citations from `statutes/` relative file paths. */
export function parseChangedStatutePaths(paths: readonly string[]): ChangedSectionRef[] {
  const seen = new Set<string>();
  const refs: ChangedSectionRef[] = [];
  const pattern = /^statutes\/title-(\d+[a-zA-Z]?)\/(?:[^/]+\/)*section-([a-zA-Z0-9-]+)\.md$/;
  for (const relPath of paths) {
    const match = pattern.exec(relPath.trim());
    if (!match?.[1] || !match[2]) continue;
    const key = `${match[1]}:${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ path: relPath.trim(), title: match[1], section: match[2], citation: `${match[1]} U.S.C. ${match[2]}` });
  }
  return refs;
}

async function listChangedSectionsBetween(repoPath: string, fromRef: string, toRef: string): Promise<ChangedSectionRef[]> {
  const raw = await gitExec(
    repoPath,
    ['diff', '--name-only', '--diff-filter=AM', '-I', FRONTMATTER_NOISE_REGEX, fromRef, toRef, '--', 'statutes'],
  ).catch(() => '');
  return parseChangedStatutePaths(raw.split('\n').filter(Boolean));
}

async function commitImportStateIfDirty(repoPath: string, latestLabel: string): Promise<void> {
  await rm(join(repoPath, '.import-progress.json'), { force: true }).catch(() => {});
  const dirtyState = await gitExec(repoPath, ['status', '--porcelain', '--', '.import-state.json']);
  if (!dirtyState) return;
  await gitExec(repoPath, ['add', '--', '.import-state.json']);
  await gitExec(repoPath, ['commit', '-m', `chore(law): Record import state through ${latestLabel}`]);
}

async function defaultAnnotateSection(annotator: Annotator, citation: string): Promise<Result<{ path: string; yaml: string }>> {
  const res = await annotator.annotateSection(citation);
  return res.ok ? ok({ path: res.value.path, yaml: annotationToYaml(res.value.annotation) }) : err(res.error);
}

async function runScopedAnnotations(opts: {
  repoPath: string;
  changedSections: readonly ChangedSectionRef[];
  latestLabel: string;
  maxAnnotations: number;
  annotateFn?: SyncLatestOptions['annotateFn'];
}): Promise<{ annotatedCount: number; annotationFailures: number }> {
  if (!opts.annotateFn && !process.env.COURTLISTENER_API_TOKEN?.trim()) {
    log.warn('Skipping scoped annotations: COURTLISTENER_API_TOKEN is not configured');
    return { annotatedCount: 0, annotationFailures: 0 };
  }
  const annotator = opts.annotateFn ? null : new Annotator();
  const targets = opts.changedSections.slice(0, Math.max(0, opts.maxAnnotations));
  let annotatedCount = 0;
  let annotationFailures = 0;

  for (const target of targets) {
    const res = opts.annotateFn ? await opts.annotateFn(target.citation) : await defaultAnnotateSection(annotator!, target.citation);
    if (!res.ok) {
      annotationFailures++;
      log.warn('Scoped annotation failed', { citation: target.citation, error: res.error.message });
      continue;
    }
    const outPath = join(opts.repoPath, res.value.path);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, res.value.yaml, 'utf-8');
    annotatedCount++;
  }

  if (annotatedCount > 0 && await gitExec(opts.repoPath, ['status', '--porcelain', '--', 'annotations'])) {
    await gitExec(opts.repoPath, ['add', '--', 'annotations']);
    await gitExec(opts.repoPath, ['commit', '-m', `chore(annotations): Sync precedent for ${opts.latestLabel}`]);
  }
  return { annotatedCount, annotationFailures };
}

function sanitizeOutputValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** Append sanitized step output key/value lines for GitHub Actions. */
export async function writeSyncOutputs(outputEnvPath: string, summary: SyncRunSummary): Promise<void> {
  const lines = [
    `has_changes=${String(summary.hasChanges)}`,
    `latest_release=${sanitizeOutputValue(summary.latestReleaseLabel)}`,
    `latest_slug=${sanitizeOutputValue(summary.latestReleaseSlug)}`,
    `pending_releases=${sanitizeOutputValue(summary.pendingReleaseLabels.join(','))}`,
    `created_tags=${sanitizeOutputValue(summary.createdTags.join(','))}`,
    `data_sha=${sanitizeOutputValue(summary.dataSha)}`,
    `sections_changed=${String(summary.sectionsChangedCount)}`,
    `annotated=${String(summary.annotatedCount)}`,
    `annotation_failures=${String(summary.annotationFailures)}`,
  ];
  await appendFile(outputEnvPath, lines.join('\n') + '\n', 'utf-8');
}

function buildPendingSummary(
  pending: readonly ReleasePointId[],
  overrides: Partial<SyncRunSummary> & { hasChanges: boolean; dryRun: boolean; dataSha: string }
): SyncRunSummary {
  const latest = pending[pending.length - 1];
  return {
    latestReleaseLabel: latest?.label ?? 'None',
    latestReleaseSlug: latest ? `pl-${releasePointKey(latest)}` : 'none',
    pendingReleaseLabels: pending.map((p) => p.label),
    pendingReleaseTags: pending.map((p) => releasePointTagName(p, 1)),
    createdTags: [],
    sectionsChangedCount: 0,
    annotatedCount: 0,
    annotationFailures: 0,
    ...overrides,
  };
}

async function executePendingSync(opts: {
  repoPath: string;
  state: ImportState;
  pending: readonly ReleasePointId[];
  existingTags: ReadonlySet<string>;
  startSha: string;
  skipAnnotations: boolean;
  maxAnnotations: number;
  fetcherFn: typeof downloadAndExtractXml;
  annotateFn?: SyncLatestOptions['annotateFn'];
  interTitleDelayMs?: number | undefined;
}): Promise<Result<SyncRunSummary>> {
  const latestPending = opts.pending[opts.pending.length - 1]!;
  const rateLimiter = new TokenBucket({ capacity: MAX_CONCURRENT_TITLES, refillRate: 1, refillIntervalMs: 1000 });
  const metrics: ImportMetrics = { releasePointsProcessed: 0, titlesChanged: 0, sectionsChanged: 0, startTime: performance.now() };

  try {
    for (const rp of opts.pending) {
      const res = await processReleasePoint(rp, opts.state, rateLimiter, metrics, opts.pending.length, {
        repoPath: opts.repoPath,
        titlesToProcess: ALL_TITLES,
        dryRun: false,
        fetcherFn: opts.fetcherFn,
        ...(opts.interTitleDelayMs !== undefined ? { interTitleDelayMs: opts.interTitleDelayMs } : {}),
      });
      if (res.collisionError || res.failedTitles > 0) {
        return err(new Error(res.collisionError ?? `Sync failed for ${rp.label}: ${res.failedTitles} failed title(s)`));
      }
    }

    await commitImportStateIfDirty(opts.repoPath, latestPending.label);
    const tagsAfter = await listPublishedReleaseTags(opts.repoPath);
    const createdTags = [...tagsAfter].filter((tag) => !opts.existingTags.has(tag)).sort();
    const changedSections = await listChangedSectionsBetween(opts.repoPath, opts.startSha, 'HEAD');
    const annStats = opts.skipAnnotations || changedSections.length === 0
      ? { annotatedCount: 0, annotationFailures: 0 }
      : await runScopedAnnotations({ repoPath: opts.repoPath, changedSections, latestLabel: latestPending.label, maxAnnotations: opts.maxAnnotations, annotateFn: opts.annotateFn });

    const finalSha = await gitExec(opts.repoPath, ['rev-parse', 'HEAD']);
    return ok(buildPendingSummary(opts.pending, {
      hasChanges: true,
      dryRun: false,
      dataSha: finalSha,
      createdTags,
      sectionsChangedCount: changedSections.length,
      ...annStats,
    }));
  } catch (e: unknown) {
    return err(new Error(`Post-import sync finalization failed: ${e instanceof Error ? e.message : String(e)}`));
  }
}

/**
 * Check for pending OLRC releases and (unless `--dry-run`) import them,
 * commit updated `.import-state.json`, and run bounded section annotations.
 */
export async function runSyncLatestRelease(options: SyncLatestOptions): Promise<Result<SyncRunSummary>> {
  const scrapeFn = options.scrapeFn ?? scrapeReleasePoints;
  let allPoints: ReleasePointId[];
  try {
    allPoints = await scrapeFn();
  } catch (e: unknown) {
    return err(new Error(`Failed to scrape OLRC release points: ${e instanceof Error ? e.message : String(e)}`));
  }

  const startSha = await gitExec(options.repoPath, ['rev-parse', 'HEAD']).catch(() => '');
  if (!startSha) return err(new Error(`Repository at '${options.repoPath}' has no valid HEAD commit`));

  try {
    const state = await loadState(options.repoPath);
    const existingTags = await listPublishedReleaseTags(options.repoPath);
    const pending = resolvePendingReleases(allPoints, state, existingTags);
    if (pending.length === 0) {
      const latest = allPoints[allPoints.length - 1];
      return ok(buildPendingSummary(latest ? [latest] : [], { hasChanges: false, dryRun: options.dryRun ?? false, dataSha: startSha, pendingReleaseLabels: [], pendingReleaseTags: [] }));
    }
    if (options.dryRun) {
      return ok(buildPendingSummary(pending, { hasChanges: true, dryRun: true, dataSha: startSha }));
    }
    return executePendingSync({
      repoPath: options.repoPath,
      state,
      pending,
      existingTags,
      startSha,
      skipAnnotations: options.skipAnnotations ?? false,
      maxAnnotations: options.maxAnnotations ?? DEFAULT_MAX_ANNOTATIONS,
      fetcherFn: options.fetcherFn ?? downloadAndExtractXml,
      annotateFn: options.annotateFn,
      interTitleDelayMs: options.interTitleDelayMs,
    });
  } catch (e: unknown) {
    return err(new Error(`Release sync preparation failed: ${e instanceof Error ? e.message : String(e)}`));
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string', short: 'r' },
      'dry-run': { type: 'boolean', default: false },
      'skip-annotations': { type: 'boolean', default: false },
      'max-annotations': { type: 'string', default: String(DEFAULT_MAX_ANNOTATIONS) },
      'output-env': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help || !values.repo) {
    process.stdout.write('Usage: npx tsx scripts/sync-latest-release.ts --repo <path> [--dry-run] [--skip-annotations] [--max-annotations 50] [--output-env <file>]\n');
    process.exit(values.help ? 0 : 1);
  }

  const parsedMax = Number.parseInt(values['max-annotations'] ?? String(DEFAULT_MAX_ANNOTATIONS), 10);
  const result = await runSyncLatestRelease({
    repoPath: values.repo,
    dryRun: values['dry-run'] ?? false,
    skipAnnotations: values['skip-annotations'] ?? false,
    maxAnnotations: Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : DEFAULT_MAX_ANNOTATIONS,
  });
  if (!result.ok) {
    log.error('Release sync failed', { error: result.error.message });
    process.exit(1);
  }
  if (values['output-env']) await writeSyncOutputs(values['output-env'], result.value);
  log.info('Release sync completed', { ...result.value });
}

if (process.argv[1]?.endsWith('sync-latest-release.ts')) {
  main().catch((error: unknown) => {
    log.error('Fatal error', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}

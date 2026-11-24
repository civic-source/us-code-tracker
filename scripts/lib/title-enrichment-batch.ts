import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { annotationToYaml, buildAnnotationPath } from '@civic-source/annotator';
import {
  PrecedentAnnotationSchema,
  SectionRegulationsSchema,
  err,
  ok,
  type ImplementingRegulation,
  type PrecedentAnnotation,
  type Result,
  type SourceAcquisitionOutcome,
} from '@civic-source/types';
import { parseAnnotationYaml } from './annotation-yaml-parser.js';
import {
  computeTitleEnrichmentCoverage,
  discoverTitleSections,
  normalizeTitleId,
  type CoverageSourceFamily,
  type DiscoveredTitleSection,
  type FailedPartitionRecord,
  type SourceCoverageSummary,
  type TitleEnrichmentCoverageReport,
  type TitleEnrichmentCoverageResult,
} from './title-enrichment-coverage.js';

export {
  computeTitleEnrichmentCoverage,
  discoverTitleSections,
  normalizeTitleId,
  type CoverageSourceFamily,
  type DiscoveredTitleSection,
  type FailedPartitionRecord,
  type SourceCoverageSummary,
  type TitleEnrichmentCoverageReport,
  type TitleEnrichmentCoverageResult,
};

export const MIN_POLITE_DELAY_MS = 500;
export const DEFAULT_MAX_CONSECUTIVE_RATE_LIMITS = 3;
const DEFAULT_SOURCES: readonly EnrichmentSource[] = ['ecfr', 'courtlistener'];

export type EnrichmentSource = 'ecfr' | 'courtlistener';

export type FetchEcfrSidecarFn = (params: {
  uscTitle: string;
  section: string;
  priorSnapshot: { data: ImplementingRegulation[]; lastSuccessAt: string } | null;
  nowIso: string;
}) => Promise<SourceAcquisitionOutcome<ImplementingRegulation[]>>;

export type FetchCourtListenerSidecarFn = (params: {
  uscTitle: string;
  section: string;
  citation: string;
  priorAnnotation: PrecedentAnnotation | null;
  nowIso: string;
}) => Promise<SourceAcquisitionOutcome<PrecedentAnnotation>>;

export interface TitleEnrichmentBatchOptions {
  dataRepoPath: string;
  uscTitle: string | number;
  sources?: readonly EnrichmentSource[] | undefined;
  releaseId?: string | undefined;
  onlyMissing?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  delayMs?: number | undefined;
  maxConsecutiveRateLimits?: number | undefined;
  dryRun?: boolean | undefined;
  nowFn?: (() => string) | undefined;
  sleepFn?: ((ms: number) => Promise<void>) | undefined;
  fetchEcfr?: FetchEcfrSidecarFn | undefined;
  fetchCourtListener?: FetchCourtListenerSidecarFn | undefined;
}

export interface PlannedSectionWork {
  section: string;
  partitionId: string;
  sources: EnrichmentSource[];
}

export interface TitleEnrichmentBatchSummary {
  uscTitle: string;
  dryRun: boolean;
  sources: EnrichmentSource[];
  onlyMissing: boolean;
  offset: number;
  limit?: number;
  effectiveDelayMs: number;
  maxConsecutiveRateLimits: number;
  totalDiscoveredSections: number;
  candidateBacklogCount: number;
  selectedCount: number;
  processedCount: number;
  skippedCount: number;
  writtenCount: number;
  failedCount: number;
  rateLimitCount: number;
  haltedByCircuitBreaker: boolean;
  haltReason?: string;
  plannedSections: PlannedSectionWork[];
  coverageBefore: TitleEnrichmentCoverageResult;
  coverageAfter: TitleEnrichmentCoverageResult;
}

interface BatchRunConfig {
  uscTitle: string; sources: EnrichmentSource[]; onlyMissing: boolean; offset: number;
  limit: number | undefined; effectiveDelayMs: number; maxConsecutiveRateLimits: number; dryRun: boolean;
}

interface ExecutionState {
  processedCount: number; writtenCount: number; failedCount: number; rateLimitCount: number;
  remoteCallsMade: number; haltedByCircuitBreaker: boolean; haltReason?: string;
  consecutiveRateLimits: Map<EnrichmentSource, number>;
}

/** Enforce the minimum 500ms polite delay floor for external API calls. */
export function clampPoliteDelayMs(delayMs?: number): number {
  if (delayMs === undefined || !Number.isFinite(delayMs)) return MIN_POLITE_DELAY_MS;
  return Math.max(MIN_POLITE_DELAY_MS, Math.floor(delayMs));
}

function validateBatchConfig(options: TitleEnrichmentBatchOptions): Result<BatchRunConfig> {
  const titleRes = normalizeTitleId(options.uscTitle);
  if (!titleRes.ok) return titleRes;
  const sources: EnrichmentSource[] = [...new Set(options.sources ?? DEFAULT_SOURCES)];
  if (sources.length === 0) return err(new Error('At least one enrichment source must be specified'));
  const offset = options.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) return err(new Error(`Invalid offset: ${String(options.offset)}`));
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) {
    return err(new Error(`Invalid limit: ${String(options.limit)}`));
  }
  const maxRates = options.maxConsecutiveRateLimits ?? DEFAULT_MAX_CONSECUTIVE_RATE_LIMITS;
  if (!Number.isInteger(maxRates) || maxRates < 1) {
    return err(new Error(`Invalid maxConsecutiveRateLimits: ${String(options.maxConsecutiveRateLimits)}`));
  }
  const dryRun = options.dryRun ?? false;
  if (!dryRun && sources.includes('ecfr') && !options.fetchEcfr) {
    return err(new Error('fetchEcfr callback is required for live eCFR enrichment'));
  }
  if (!dryRun && sources.includes('courtlistener') && !options.fetchCourtListener) {
    return err(new Error('fetchCourtListener callback is required for live CourtListener enrichment'));
  }
  return ok({
    uscTitle: titleRes.value,
    sources,
    onlyMissing: options.onlyMissing ?? true,
    offset,
    limit: options.limit,
    effectiveDelayMs: clampPoliteDelayMs(options.delayMs),
    maxConsecutiveRateLimits: maxRates,
    dryRun,
  });
}

function planSectionWork(
  sections: readonly DiscoveredTitleSection[],
  coverageBefore: TitleEnrichmentCoverageResult,
  config: BatchRunConfig
): { backlog: PlannedSectionWork[]; selected: PlannedSectionWork[] } {
  const ecfrCompleted = new Set(coverageBefore.coverages.find((c) => c.sourceFamily === 'ecfr')?.completedPartitions ?? []);
  const clCompleted = new Set(coverageBefore.coverages.find((c) => c.sourceFamily === 'courtlistener')?.completedPartitions ?? []);
  const backlog: PlannedSectionWork[] = [];
  for (const sec of sections) {
    const needed = config.sources.filter((src) =>
      !config.onlyMissing ? true : src === 'ecfr' ? !ecfrCompleted.has(sec.partitionId) : !clCompleted.has(sec.partitionId)
    );
    if (needed.length > 0) backlog.push({ section: sec.section, partitionId: sec.partitionId, sources: needed });
  }
  const end = config.limit !== undefined ? config.offset + config.limit : undefined;
  return { backlog, selected: backlog.slice(config.offset, end) };
}

async function loadPriorRegSnapshot(
  filePath: string
): Promise<{ data: ImplementingRegulation[]; lastSuccessAt: string } | null> {
  try {
    const parsed = SectionRegulationsSchema.safeParse(JSON.parse(await readFile(filePath, 'utf-8')));
    if (!parsed.success) return null;
    const st = parsed.data.refreshStatus;
    if ((st?.status === 'failed' || st?.status === 'partial') && !st.retainedPriorSnapshot) return null;
    return { data: parsed.data.regulations, lastSuccessAt: st?.lastSuccessAt ?? parsed.data.lastUpdated };
  } catch {
    return null;
  }
}

async function loadPriorAnnotation(filePath: string): Promise<PrecedentAnnotation | null> {
  try {
    const parsed = parseAnnotationYaml(await readFile(filePath, 'utf-8'));
    if (!parsed.ok) return null;
    const st = parsed.value.refreshStatus;
    if ((st?.status === 'failed' || st?.status === 'partial') && !st.retainedPriorSnapshot) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

async function writeFileSafe(filePath: string, content: string): Promise<Result<void>> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
    return ok(undefined);
  } catch (error: unknown) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

function buildRefreshStatus(outcome: SourceAcquisitionOutcome<ImplementingRegulation[]>) {
  return {
    source: outcome.source, scope: outcome.scope, status: outcome.status, observedAt: outcome.observedAt,
    ...(outcome.lastSuccessAt ? { lastSuccessAt: outcome.lastSuccessAt } : {}),
    retainedPriorSnapshot: outcome.retainedPriorSnapshot, isStale: outcome.isStale,
    ...(outcome.httpStatus !== undefined ? { httpStatus: outcome.httpStatus } : {}),
    ...(outcome.failureKind ? { failureKind: outcome.failureKind } : {}),
    ...(outcome.errorMessage ? { errorMessage: outcome.errorMessage } : {}),
    ...(outcome.completedPages !== undefined ? { completedPages: outcome.completedPages } : {}),
    ...(outcome.expectedPages !== undefined ? { expectedPages: outcome.expectedPages } : {}),
  };
}

async function writeEcfrSidecar(
  filePath: string, uscTitle: string, section: string, outcome: SourceAcquisitionOutcome<ImplementingRegulation[]>
): Promise<Result<void>> {
  const parsed = SectionRegulationsSchema.safeParse({
    targetSection: `${uscTitle}-${section}`,
    lastUpdated: outcome.observedAt,
    refreshStatus: buildRefreshStatus(outcome),
    regulations: outcome.data,
  });
  return parsed.success ? writeFileSafe(filePath, JSON.stringify(parsed.data, null, 2) + '\n') : err(new Error(parsed.error.message));
}

async function writeAnnotationSidecar(
  filePath: string,
  outcome: SourceAcquisitionOutcome<PrecedentAnnotation>
): Promise<Result<void>> {
  const parsed = PrecedentAnnotationSchema.safeParse(outcome.data);
  return parsed.success ? writeFileSafe(filePath, annotationToYaml(parsed.data)) : err(new Error(parsed.error.message));
}

const RATE_LIMIT_MSG_RE = /\b(?:http|status)\s*429\b|\b429\s+too many requests\b|rate[\s-]?limit|too many requests/i;

function recordOutcomeAndCheckBreaker<T>(
  source: EnrichmentSource,
  outcome: SourceAcquisitionOutcome<T>,
  hasPrior: boolean,
  config: BatchRunConfig,
  state: ExecutionState
): boolean {
  const isRateLimited =
    outcome.failureKind === 'rate_limited' || outcome.httpStatus === 429 || RATE_LIMIT_MSG_RE.test(outcome.errorMessage ?? '');
  if (isRateLimited) {
    state.rateLimitCount += 1;
    const nextStreak = (state.consecutiveRateLimits.get(source) ?? 0) + 1;
    state.consecutiveRateLimits.set(source, nextStreak);
    if (nextStreak >= config.maxConsecutiveRateLimits) {
      state.haltedByCircuitBreaker = true;
      state.haltReason = `Circuit breaker tripped after ${nextStreak} consecutive ${source} rate-limit responses`;
    }
  } else {
    state.consecutiveRateLimits.set(source, 0);
  }
  const isSuccess = outcome.status === 'success-empty' || outcome.status === 'success-nonempty';
  return (isSuccess || (outcome.status === 'partial' && !hasPrior)) && !outcome.retainedPriorSnapshot;
}

async function safeInvokeFetcher<T>(
  source: EnrichmentSource, scope: string, nowIso: string, fallbackData: T,
  invoke: () => Promise<SourceAcquisitionOutcome<T>>
): Promise<SourceAcquisitionOutcome<T>> {
  try {
    return await invoke();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      status: 'failed', source, scope, observedAt: nowIso, data: fallbackData,
      retainedPriorSnapshot: false, isStale: true,
      failureKind: RATE_LIMIT_MSG_RE.test(msg) ? 'rate_limited' : 'network_error',
      errorMessage: msg,
    };
  }
}

async function runSingleSource(
  source: EnrichmentSource, section: string, options: TitleEnrichmentBatchOptions,
  config: BatchRunConfig, state: ExecutionState
): Promise<void> {
  if (state.remoteCallsMade > 0) {
    const sleep = options.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    await sleep(config.effectiveDelayMs);
  }
  state.remoteCallsMade += 1;
  const nowIso = (options.nowFn ?? (() => new Date().toISOString()))();
  const citation = `${config.uscTitle} U.S.C. ${section}`;

  let writeRes: Result<void> | null = null;
  let outcomeStatus: SourceAcquisitionOutcome<unknown>['status'];
  if (source === 'ecfr') {
    const outFile = join(options.dataRepoPath, 'regulations', `title-${config.uscTitle}`, `section-${section}.json`);
    const prior = await loadPriorRegSnapshot(outFile);
    const outcome = await safeInvokeFetcher('ecfr', citation, nowIso, prior?.data ?? [], () =>
      options.fetchEcfr!({ uscTitle: config.uscTitle, section, priorSnapshot: prior, nowIso })
    );
    outcomeStatus = outcome.status;
    if (recordOutcomeAndCheckBreaker('ecfr', outcome, prior !== null, config, state)) {
      writeRes = await writeEcfrSidecar(outFile, config.uscTitle, section, outcome);
    }
  } else {
    const outFile = join(options.dataRepoPath, buildAnnotationPath(citation));
    const priorAnn = await loadPriorAnnotation(outFile);
    const emptyAnn: PrecedentAnnotation = { targetSection: citation, lastSyncedET: nowIso, cases: [] };
    const outcome = await safeInvokeFetcher('courtlistener', citation, nowIso, priorAnn ?? emptyAnn, () =>
      options.fetchCourtListener!({ uscTitle: config.uscTitle, section, citation, priorAnnotation: priorAnn, nowIso })
    );
    outcomeStatus = outcome.status;
    if (recordOutcomeAndCheckBreaker('courtlistener', outcome, priorAnn !== null, config, state)) {
      writeRes = await writeAnnotationSidecar(outFile, outcome);
    }
  }

  if (writeRes?.ok) state.writtenCount += 1;
  if (!writeRes?.ok || outcomeStatus === 'partial' || outcomeStatus === 'failed') state.failedCount += 1;
}

async function executeSelectedWork(
  selected: readonly PlannedSectionWork[],
  options: TitleEnrichmentBatchOptions,
  config: BatchRunConfig
): Promise<ExecutionState> {
  const state: ExecutionState = {
    processedCount: 0,
    writtenCount: 0,
    failedCount: 0,
    rateLimitCount: 0,
    remoteCallsMade: 0,
    haltedByCircuitBreaker: false,
    consecutiveRateLimits: new Map(),
  };
  if (config.dryRun) return state;
  for (const plan of selected) {
    if (state.haltedByCircuitBreaker) break;
    state.processedCount += 1;
    for (const source of plan.sources) {
      if (state.haltedByCircuitBreaker) break;
      await runSingleSource(source, plan.section, options, config, state);
    }
  }
  return state;
}

/**
 * Resumable, rate-limit-guarded batch enrichment runner for a U.S. Code title.
 * Validates sidecars before writing, preserves prior valid sidecars on failure,
 * enforces a 500ms polite delay floor, and trips a circuit breaker on repeated 429s.
 */
export async function runTitleEnrichmentBatch(
  options: TitleEnrichmentBatchOptions
): Promise<Result<TitleEnrichmentBatchSummary, Error>> {
  const cfgRes = validateBatchConfig(options);
  if (!cfgRes.ok) return cfgRes;
  const config = cfgRes.value;
  const sectionsRes = await discoverTitleSections(options.dataRepoPath, config.uscTitle);
  if (!sectionsRes.ok) return sectionsRes;
  const nowFn = options.nowFn ?? (() => new Date().toISOString());
  const covBeforeRes = await computeTitleEnrichmentCoverage({
    dataRepoPath: options.dataRepoPath, uscTitle: config.uscTitle, releaseId: options.releaseId, observedAt: nowFn(),
  });
  if (!covBeforeRes.ok) return covBeforeRes;

  const { backlog, selected } = planSectionWork(sectionsRes.value, covBeforeRes.value, config);
  const state = await executeSelectedWork(selected, options, config);
  const covAfterRes = config.dryRun
    ? covBeforeRes
    : await computeTitleEnrichmentCoverage({
        dataRepoPath: options.dataRepoPath, uscTitle: config.uscTitle, releaseId: options.releaseId, observedAt: nowFn(),
      });
  if (!covAfterRes.ok) return covAfterRes;

  return ok({
    uscTitle: config.uscTitle, dryRun: config.dryRun, sources: config.sources,
    onlyMissing: config.onlyMissing, offset: config.offset,
    ...(config.limit !== undefined ? { limit: config.limit } : {}),
    effectiveDelayMs: config.effectiveDelayMs, maxConsecutiveRateLimits: config.maxConsecutiveRateLimits,
    totalDiscoveredSections: sectionsRes.value.length, candidateBacklogCount: backlog.length,
    selectedCount: selected.length, processedCount: state.processedCount,
    skippedCount: sectionsRes.value.length - backlog.length, writtenCount: state.writtenCount,
    failedCount: state.failedCount, rateLimitCount: state.rateLimitCount,
    haltedByCircuitBreaker: state.haltedByCircuitBreaker,
    ...(state.haltReason ? { haltReason: state.haltReason } : {}),
    plannedSections: selected, coverageBefore: covBeforeRes.value, coverageAfter: covAfterRes.value,
  });
}

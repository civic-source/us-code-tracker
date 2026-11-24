import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { buildAnnotationPath } from '@civic-source/annotator';
import { compareSectionNumbers } from '@civic-source/shared';
import {
  CollectionCoverageSchema,
  SectionRegulationsSchema,
  err,
  ok,
  type CollectionCoverage,
  type CollectionCoverageState,
  type Result,
  type SourceFetchFailureKind,
} from '@civic-source/types';

export type CoverageSourceFamily = 'olrc_uslm' | 'ecfr' | 'courtlistener';

export interface DiscoveredTitleSection {
  uscTitle: string;
  chapter: string;
  section: string;
  statuteRelPath: string;
  partitionId: string;
}

export interface FailedPartitionRecord {
  partition: string;
  reason: string;
  failureKind?: SourceFetchFailureKind;
}

export interface SourceCoverageSummary {
  sourceFamily: CoverageSourceFamily;
  coverageState: CollectionCoverageState;
  expectedCount: number;
  completedCount: number;
  missingCount: number;
  failedCount: number;
  missingPartitions: string[];
  failedPartitions: FailedPartitionRecord[];
}

export interface TitleEnrichmentCoverageReport {
  uscTitle: string;
  releaseId?: string;
  observedAt: string;
  totalSections: number;
  sources: {
    olrc_uslm: SourceCoverageSummary;
    ecfr: SourceCoverageSummary;
    courtlistener: SourceCoverageSummary;
  };
}

export interface TitleEnrichmentCoverageResult {
  report: TitleEnrichmentCoverageReport;
  coverages: CollectionCoverage[];
}

export interface SidecarCheckResult {
  status: 'valid' | 'missing' | 'failed';
  reason?: string;
}

const SAFE_TITLE_REGEX = /^0*([1-9][0-9]*)([a-zA-Z]?)$/;
const SECTION_FILE_REGEX = /^section-([a-zA-Z0-9-]+)\.md$/;

/** Validate and normalize a U.S. Code title identifier (for example "018" -> "18", "5a" -> "5a"). */
export function normalizeTitleId(uscTitle: string | number): Result<string> {
  const trimmed = String(uscTitle).trim();
  const stripped = /^title-/i.test(trimmed) ? trimmed.slice(6) : trimmed;
  if (!/^[0-9]+[a-zA-Z]?$/.test(stripped)) {
    return err(new Error(`Invalid U.S. Code title identifier: "${String(uscTitle)}"`));
  }
  const match = SAFE_TITLE_REGEX.exec(stripped);
  if (!match?.[1]) {
    return err(new Error(`Invalid U.S. Code title identifier: "${String(uscTitle)}"`));
  }
  return ok(`${match[1]}${match[2] ?? ''}`);
}

function extractChapterFromRelPath(relToTitleDir: string): string {
  const segments = relToTitleDir.split(sep).slice(0, -1);
  const chapterSeg = segments.find((seg) => /^chapter-/i.test(seg));
  if (chapterSeg) return chapterSeg.slice('chapter-'.length);
  return segments[segments.length - 1] ?? 'root';
}

async function walkStatuteDir(
  dirPath: string,
  titleDir: string,
  dataRepoPath: string,
  uscTitle: string,
  bySection: Map<string, DiscoveredTitleSection>
): Promise<void> {
  const entries = (await readdir(dirPath, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walkStatuteDir(fullPath, titleDir, dataRepoPath, uscTitle, bySection);
      continue;
    }
    if (!entry.isFile()) continue;
    const match = SECTION_FILE_REGEX.exec(entry.name);
    if (!match?.[1] || bySection.has(match[1])) continue;
    const section = match[1];
    bySection.set(section, {
      uscTitle,
      chapter: extractChapterFromRelPath(relative(titleDir, fullPath)),
      section,
      statuteRelPath: relative(dataRepoPath, fullPath).split(sep).join('/'),
      partitionId: `title-${uscTitle}/section-${section}`,
    });
  }
}

/**
 * Recursively discover statute sections for a title under `statutes/title-<N>`,
 * deduplicated and sorted via natural section ordering.
 */
export async function discoverTitleSections(
  dataRepoPath: string,
  uscTitle: string | number
): Promise<Result<DiscoveredTitleSection[]>> {
  const normRes = normalizeTitleId(uscTitle);
  if (!normRes.ok) return normRes;
  const title = normRes.value;

  const repoStats = await stat(dataRepoPath).catch(() => null);
  if (!repoStats?.isDirectory()) {
    return err(new Error(`Data repository path is not a readable directory: ${dataRepoPath}`));
  }
  const titleDir = join(dataRepoPath, 'statutes', `title-${title}`);
  if (!existsSync(titleDir)) return ok([]);
  const titleStats = await stat(titleDir).catch(() => null);
  if (!titleStats?.isDirectory()) {
    return err(new Error(`Statute title path is not a directory: ${titleDir}`));
  }

  const bySection = new Map<string, DiscoveredTitleSection>();
  await walkStatuteDir(titleDir, titleDir, dataRepoPath, title, bySection);
  const sections = [...bySection.values()].sort((a, b) =>
    compareSectionNumbers(a.section, b.section)
  );
  return ok(sections);
}

/** Validate raw regulation JSON sidecar text against SectionRegulationsSchema and refresh state. */
export function validateEcfrRaw(raw: string): SidecarCheckResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { status: 'failed', reason: 'Malformed regulation JSON sidecar' };
  }
  const parsed = SectionRegulationsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: 'failed', reason: 'Regulation JSON failed schema validation' };
  }
  const refresh = parsed.data.refreshStatus;
  if (refresh?.status === 'failed' && !refresh.retainedPriorSnapshot) {
    return { status: 'failed', reason: refresh.errorMessage ?? 'Prior eCFR fetch failed' };
  }
  return { status: 'valid' };
}

/** Validate raw annotation YAML sidecar text structurally without adding external YAML deps. */
export function validateAnnotationRaw(raw: string): SidecarCheckResult {
  if (!/^targetSection:\s*\S+/m.test(raw) || !/^lastSyncedET:\s*\S+/m.test(raw) || !/^cases:/m.test(raw)) {
    return { status: 'failed', reason: 'Annotation YAML missing required top-level keys' };
  }
  const refreshMatch = /^refreshStatus:\s*\n((?:[ \t]+.*\n?)*)/m.exec(raw);
  if (refreshMatch?.[1]) {
    const block = refreshMatch[1];
    const isFailed = /^\s+status:\s*['"]?failed['"]?\s*$/m.test(block);
    const retained = /^\s+retainedPriorSnapshot:\s*true\s*$/m.test(block);
    if (isFailed && !retained) {
      return { status: 'failed', reason: 'Prior CourtListener fetch failed without snapshot' };
    }
  }
  return { status: 'valid' };
}

/** Read and validate a sidecar file, distinguishing missing (`ENOENT`) from invalid/failed. */
export async function inspectSidecar(
  filePath: string,
  validateRaw: (raw: string) => SidecarCheckResult
): Promise<SidecarCheckResult> {
  try {
    return validateRaw(await readFile(filePath, 'utf-8'));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { status: 'missing' };
    }
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

function resolveCoverageState(
  expectedCount: number,
  completedCount: number,
  failedCount: number
): CollectionCoverageState {
  if (expectedCount === 0 || (completedCount === 0 && failedCount === 0)) return 'not_collected';
  if (completedCount === 0 && failedCount > 0) return 'failed';
  if (completedCount === expectedCount && failedCount === 0) return 'complete';
  return 'partial';
}

function buildValidatedCoverage(params: {
  sourceFamily: CoverageSourceFamily;
  uscTitle: string;
  releaseId: string | undefined;
  observedAt: string;
  expectedPartitions: string[];
  completedPartitions: string[];
  failedPartitions: FailedPartitionRecord[];
}): { summary: SourceCoverageSummary; coverage: CollectionCoverage } {
  const { sourceFamily, uscTitle, releaseId, observedAt, expectedPartitions, completedPartitions, failedPartitions } = params;
  const completedSet = new Set(completedPartitions);
  const missingPartitions = expectedPartitions.filter((p) => !completedSet.has(p));
  const coverageState = resolveCoverageState(expectedPartitions.length, completedPartitions.length, failedPartitions.length);
  const scopePrefix = sourceFamily === 'olrc_uslm' && releaseId ? `olrc:${releaseId}` : sourceFamily === 'olrc_uslm' ? 'olrc' : sourceFamily;

  const coverage = CollectionCoverageSchema.parse({
    schemaVersion: 'usct.collection-coverage/v1',
    coverageId: `cov-${releaseId ?? 'current'}-${sourceFamily}-title-${uscTitle}`,
    sourceScope: `${scopePrefix}:title-${uscTitle}`,
    sourceFamily,
    ...(releaseId ? { releaseId } : {}),
    titleFilter: uscTitle,
    expectedPartitions,
    completedPartitions,
    absentPartitions: [],
    failedPartitions,
    coverageState,
    lastAttemptedAt: observedAt,
    ...(coverageState === 'complete' ? { lastCompletedAt: observedAt } : {}),
    isRequiredForPublication: sourceFamily === 'olrc_uslm',
  });

  return {
    summary: {
      sourceFamily,
      coverageState,
      expectedCount: expectedPartitions.length,
      completedCount: completedPartitions.length,
      missingCount: missingPartitions.length,
      failedCount: failedPartitions.length,
      missingPartitions,
      failedPartitions,
    },
    coverage,
  };
}

async function evaluateSidecarFamily(params: {
  dataRepoPath: string;
  uscTitle: string;
  releaseId: string | undefined;
  observedAt: string;
  sections: readonly DiscoveredTitleSection[];
  sourceFamily: 'ecfr' | 'courtlistener';
}): Promise<{ summary: SourceCoverageSummary; coverage: CollectionCoverage }> {
  const completedPartitions: string[] = [];
  const failedPartitions: FailedPartitionRecord[] = [];
  const isEcfr = params.sourceFamily === 'ecfr';

  for (const sec of params.sections) {
    const filePath = isEcfr
      ? join(params.dataRepoPath, 'regulations', `title-${params.uscTitle}`, `section-${sec.section}.json`)
      : join(params.dataRepoPath, buildAnnotationPath(`${params.uscTitle} U.S.C. ${sec.section}`));
    const check = await inspectSidecar(filePath, isEcfr ? validateEcfrRaw : validateAnnotationRaw);
    if (check.status === 'valid') completedPartitions.push(sec.partitionId);
    else if (check.status === 'failed') {
      failedPartitions.push({ partition: sec.partitionId, reason: check.reason ?? 'Sidecar validation failed' });
    }
  }

  return buildValidatedCoverage({
    sourceFamily: params.sourceFamily,
    uscTitle: params.uscTitle,
    releaseId: params.releaseId,
    observedAt: params.observedAt,
    expectedPartitions: params.sections.map((s) => s.partitionId),
    completedPartitions,
    failedPartitions,
  });
}

/**
 * Compute title-parameterized CollectionCoverage records and summary metrics across
 * `olrc_uslm`, `ecfr`, and `courtlistener`, preserving natural section ordering.
 */
export async function computeTitleEnrichmentCoverage(params: {
  dataRepoPath: string;
  uscTitle: string | number;
  releaseId?: string | undefined;
  observedAt?: string | undefined;
}): Promise<Result<TitleEnrichmentCoverageResult>> {
  const titleRes = normalizeTitleId(params.uscTitle);
  if (!titleRes.ok) return titleRes;
  const normalizedTitle = titleRes.value;

  const sectionsRes = await discoverTitleSections(params.dataRepoPath, normalizedTitle);
  if (!sectionsRes.ok) return sectionsRes;

  const observedAt = params.observedAt ?? new Date().toISOString();
  const expectedPartitions = sectionsRes.value.map((s) => s.partitionId);
  const olrc = buildValidatedCoverage({
    sourceFamily: 'olrc_uslm',
    uscTitle: normalizedTitle,
    releaseId: params.releaseId,
    observedAt,
    expectedPartitions,
    completedPartitions: expectedPartitions,
    failedPartitions: [],
  });
  const ecfr = await evaluateSidecarFamily({
    dataRepoPath: params.dataRepoPath,
    uscTitle: normalizedTitle,
    releaseId: params.releaseId,
    observedAt,
    sections: sectionsRes.value,
    sourceFamily: 'ecfr',
  });
  const courtlistener = await evaluateSidecarFamily({
    dataRepoPath: params.dataRepoPath,
    uscTitle: normalizedTitle,
    releaseId: params.releaseId,
    observedAt,
    sections: sectionsRes.value,
    sourceFamily: 'courtlistener',
  });

  return ok({
    report: {
      uscTitle: normalizedTitle,
      ...(params.releaseId ? { releaseId: params.releaseId } : {}),
      observedAt,
      totalSections: sectionsRes.value.length,
      sources: { olrc_uslm: olrc.summary, ecfr: ecfr.summary, courtlistener: courtlistener.summary },
    },
    coverages: [olrc.coverage, ecfr.coverage, courtlistener.coverage],
  });
}

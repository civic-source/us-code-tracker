import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CollectionCoverageSchema,
  PrecedentAnnotationSchema,
  SectionRegulationsSchema,
  type ImplementingRegulation,
  type PrecedentAnnotation,
  type SourceAcquisitionOutcome,
} from '@civic-source/types';
import {
  DEFAULT_MAX_CONSECUTIVE_RATE_LIMITS,
  MIN_POLITE_DELAY_MS,
  clampPoliteDelayMs,
  computeTitleEnrichmentCoverage,
  discoverTitleSections,
  normalizeTitleId,
  runTitleEnrichmentBatch,
} from '../lib/title-enrichment-batch.js';
import { buildTitleCoverageRecords } from '../lib/canonical-vertical-slice.js';
import { CanonicalWorkbenchCatalog } from '../lib/workbench-catalog.js';
import { runEnrichTitleCli } from '../enrich-title.js';

const FIXED_NOW = '2026-11-24T04:00:00.000Z';

async function writeStatuteFixture(
  dataRepoPath: string,
  uscTitle: string,
  chapter: string,
  section: string
): Promise<void> {
  const dir = join(dataRepoPath, 'statutes', `title-${uscTitle}`, `chapter-${chapter}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `section-${section}.md`),
    `---\ntitle: "Section ${section}"\nusc_title: "${uscTitle}"\nusc_section: "${section}"\nchapter: ${chapter}\n---\n\nText for ${uscTitle} U.S.C. ${section}.\n`,
    'utf-8'
  );
}

async function writeValidRegSidecar(
  dataRepoPath: string,
  uscTitle: string,
  section: string,
  agency = 'Test Agency'
): Promise<string> {
  const dir = join(dataRepoPath, 'regulations', `title-${uscTitle}`);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `section-${section}.json`);
  const payload = SectionRegulationsSchema.parse({
    targetSection: `${uscTitle}-${section}`,
    lastUpdated: FIXED_NOW,
    refreshStatus: {
      source: 'ecfr',
      scope: `${uscTitle} U.S.C. ${section}`,
      status: 'success-nonempty',
      observedAt: FIXED_NOW,
      lastSuccessAt: FIXED_NOW,
      retainedPriorSnapshot: false,
      isStale: false,
    },
    regulations: [
      {
        cfrTitle: 19,
        cfrPart: 162,
        agency,
        ecfrUrl: 'https://www.ecfr.gov/current/title-19/part-162',
        extractionState: 'candidate',
        editorialReview: 'unreviewed',
        relationshipType: 'text_match_candidate',
      },
    ],
  });
  await writeFile(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  return filePath;
}

async function writeValidAnnotationSidecar(
  dataRepoPath: string,
  uscTitle: string,
  section: string,
  caseName = 'United States v. Test'
): Promise<string> {
  const dir = join(dataRepoPath, 'annotations', `title-${uscTitle}`);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `section-${section}.yaml`);
  const yaml = [
    `targetSection: "${uscTitle} U.S.C. ${section}"`,
    `lastSyncedET: "${FIXED_NOW}"`,
    'cases:',
    `  - caseName: "${caseName}"`,
    '    citation: "522 U.S. 398"',
    '    court: "SCOTUS"',
    '    date: "1998-01-26"',
    '    holdingSummary: "Test excerpt."',
    '    sourceUrl: "https://www.courtlistener.com/opinion/118168/brogan-v-united-states/"',
    '    impact: "unverified_mention"',
  ].join('\n') + '\n';
  await writeFile(filePath, yaml, 'utf-8');
  return filePath;
}

function makeEcfrSuccess(
  uscTitle: string,
  section: string,
  agency = 'Mock Agency'
): SourceAcquisitionOutcome<ImplementingRegulation[]> {
  return {
    status: 'success-nonempty',
    source: 'ecfr',
    scope: `${uscTitle} U.S.C. ${section}`,
    observedAt: FIXED_NOW,
    lastSuccessAt: FIXED_NOW,
    data: [
      {
        cfrTitle: 28,
        cfrPart: 50,
        agency,
        ecfrUrl: 'https://www.ecfr.gov/current/title-28/part-50',
        extractionState: 'candidate',
        editorialReview: 'unreviewed',
        relationshipType: 'text_match_candidate',
      },
    ],
    retainedPriorSnapshot: false,
    isStale: false,
    completedPages: 1,
    expectedPages: 1,
  };
}

function makeEcfrRateLimited(
  uscTitle: string,
  section: string,
  prior: { data: ImplementingRegulation[]; lastSuccessAt: string } | null
): SourceAcquisitionOutcome<ImplementingRegulation[]> {
  return {
    status: 'failed',
    source: 'ecfr',
    scope: `${uscTitle} U.S.C. ${section}`,
    observedAt: FIXED_NOW,
    lastSuccessAt: prior?.lastSuccessAt,
    data: prior?.data ?? [],
    retainedPriorSnapshot: prior !== null,
    isStale: true,
    httpStatus: 429,
    failureKind: 'rate_limited',
    errorMessage: 'eCFR search API returned HTTP 429',
  };
}

function makeCourtListenerSuccess(
  uscTitle: string,
  section: string
): SourceAcquisitionOutcome<PrecedentAnnotation> {
  return {
    status: 'success-nonempty',
    source: 'courtlistener',
    scope: `${uscTitle} U.S.C. ${section}`,
    observedAt: FIXED_NOW,
    lastSuccessAt: FIXED_NOW,
    data: PrecedentAnnotationSchema.parse({
      targetSection: `${uscTitle} U.S.C. ${section}`,
      lastSyncedET: FIXED_NOW,
      cases: [
        {
          caseName: 'United States v. Sample',
          citation: '100 F.4th 1',
          court: 'Appellate',
          date: '2024-05-01',
          holdingSummary: 'Sample snippet.',
          retrievalExcerpt: 'Sample snippet.',
          retrievalQuery: `"${uscTitle} U.S.C. ${section}"`,
          retrievedAt: FIXED_NOW,
          extractionState: 'candidate',
          editorialReview: 'unreviewed',
          versionAlignmentState: 'unknown',
          sourceUrl: 'https://www.courtlistener.com/opinion/99999/sample/',
          impact: 'unverified_mention',
        },
      ],
    }),
    retainedPriorSnapshot: false,
    isStale: false,
  };
}

describe('title-enrichment-batch (USCT title-parameterized coverage & resumable batch runner)', () => {
  const tempDirs: string[] = [];

  async function createTempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'usct-title-batch-'));
    tempDirs.push(dir);
    await mkdir(join(dir, 'statutes'), { recursive: true });
    return dir;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('validates safe title formats and discovers deduplicated naturally-sorted sections across multiple titles', async () => {
    const repo = await createTempRepo();

    expect(normalizeTitleId('18')).toEqual({ ok: true, value: '18' });
    expect(normalizeTitleId(10)).toEqual({ ok: true, value: '10' });
    expect(normalizeTitleId('05a')).toEqual({ ok: true, value: '5a' });
    expect(normalizeTitleId('title-26')).toEqual({ ok: true, value: '26' });
    expect(normalizeTitleId('../18').ok).toBe(false);
    expect(normalizeTitleId('18/chapter-1').ok).toBe(false);
    expect(normalizeTitleId('0').ok).toBe(false);
    expect(normalizeTitleId('').ok).toBe(false);

    // Title 18 with out-of-order sections + duplicate filename in nested subdir
    await writeStatuteFixture(repo, '18', '47', '1001');
    await writeStatuteFixture(repo, '18', '1', '2');
    await writeStatuteFixture(repo, '18', '7', '111');
    await writeStatuteFixture(repo, '18', '9', '175b');
    await writeStatuteFixture(repo, '18', '1', '10');
    const dupDir = join(repo, 'statutes', 'title-18', 'chapter-47', 'subchapter-a');
    await mkdir(dupDir, { recursive: true });
    await writeFile(join(dupDir, 'section-1001.md'), '# duplicate\n', 'utf-8');

    // Title 10 and Title 26 fixtures
    await writeStatuteFixture(repo, '10', '1', '101');
    await writeStatuteFixture(repo, '26', '1', '1');
    await writeStatuteFixture(repo, '26', '2', '2000e-2');
    await writeStatuteFixture(repo, '26', '2', '2000e-1');

    const t18 = await discoverTitleSections(repo, '18');
    expect(t18.ok).toBe(true);
    if (!t18.ok) return;
    expect(t18.value.map((s) => s.section)).toEqual(['2', '10', '111', '175b', '1001']);
    expect(t18.value[0]).toEqual({
      uscTitle: '18',
      chapter: '1',
      section: '2',
      statuteRelPath: 'statutes/title-18/chapter-1/section-2.md',
      partitionId: 'title-18/section-2',
    });

    const t10 = await discoverTitleSections(repo, 10);
    expect(t10.ok).toBe(true);
    if (!t10.ok) return;
    expect(t10.value.map((s) => s.partitionId)).toEqual(['title-10/section-101']);

    const t26 = await discoverTitleSections(repo, '26');
    expect(t26.ok).toBe(true);
    if (!t26.ok) return;
    expect(t26.value.map((s) => s.section)).toEqual(['1', '2000e-1', '2000e-2']);
  });

  it('computes accurate CollectionCoverage (complete, partial, not_collected, failed) for olrc_uslm, ecfr, and courtlistener', async () => {
    const repo = await createTempRepo();

    // Title 18: 3 sections -> ecfr partial (1/3), courtlistener partial (2/3)
    await writeStatuteFixture(repo, '18', '1', '10');
    await writeStatuteFixture(repo, '18', '1', '2');
    await writeStatuteFixture(repo, '18', '47', '1001');
    await writeValidRegSidecar(repo, '18', '1001');
    await writeValidAnnotationSidecar(repo, '18', '2');
    await writeValidAnnotationSidecar(repo, '18', '1001');

    // Title 10: 2 sections -> all complete (2/2)
    await writeStatuteFixture(repo, '10', '1', '101');
    await writeStatuteFixture(repo, '10', '1', '102');
    await writeValidRegSidecar(repo, '10', '101');
    await writeValidRegSidecar(repo, '10', '102');
    await writeValidAnnotationSidecar(repo, '10', '101');
    await writeValidAnnotationSidecar(repo, '10', '102');

    // Title 26: 2 sections -> olrc_uslm complete, ecfr & courtlistener not_collected
    await writeStatuteFixture(repo, '26', '1', '1');
    await writeStatuteFixture(repo, '26', '1', '2');

    const cov18Res = await computeTitleEnrichmentCoverage({
      dataRepoPath: repo,
      uscTitle: '18',
      releaseId: 'pl-119-73',
      observedAt: FIXED_NOW,
    });
    expect(cov18Res.ok).toBe(true);
    if (!cov18Res.ok) return;

    for (const cov of cov18Res.value.coverages) {
      expect(() => CollectionCoverageSchema.parse(cov)).not.toThrow();
    }

    const byFamily18 = new Map(cov18Res.value.coverages.map((c) => [c.sourceFamily, c]));
    expect(byFamily18.get('olrc_uslm')?.coverageState).toBe('complete');
    expect(byFamily18.get('olrc_uslm')?.expectedPartitions).toEqual([
      'title-18/section-2',
      'title-18/section-10',
      'title-18/section-1001',
    ]);
    expect(byFamily18.get('ecfr')?.coverageState).toBe('partial');
    expect(byFamily18.get('ecfr')?.completedPartitions).toEqual(['title-18/section-1001']);
    expect(byFamily18.get('courtlistener')?.coverageState).toBe('partial');
    expect(byFamily18.get('courtlistener')?.completedPartitions).toEqual([
      'title-18/section-2',
      'title-18/section-1001',
    ]);

    const cov10Res = await computeTitleEnrichmentCoverage({
      dataRepoPath: repo,
      uscTitle: '10',
      releaseId: 'pl-119-73',
      observedAt: FIXED_NOW,
    });
    expect(cov10Res.ok).toBe(true);
    if (!cov10Res.ok) return;
    expect(cov10Res.value.coverages.every((c) => c.coverageState === 'complete')).toBe(true);

    const cov26Res = await computeTitleEnrichmentCoverage({
      dataRepoPath: repo,
      uscTitle: '26',
      releaseId: 'pl-119-73',
      observedAt: FIXED_NOW,
    });
    expect(cov26Res.ok).toBe(true);
    if (!cov26Res.ok) return;
    const byFamily26 = new Map(cov26Res.value.coverages.map((c) => [c.sourceFamily, c]));
    expect(byFamily26.get('olrc_uslm')?.coverageState).toBe('complete');
    expect(byFamily26.get('ecfr')?.coverageState).toBe('not_collected');
    expect(byFamily26.get('courtlistener')?.coverageState).toBe('not_collected');
  });

  it('supports resumable --only-missing slicing with offset and limit', async () => {
    const repo = await createTempRepo();
    for (const sec of ['1', '2', '10', '111', '1001']) {
      await writeStatuteFixture(repo, '18', '1', sec);
    }
    await writeValidRegSidecar(repo, '18', '1');
    await writeValidRegSidecar(repo, '18', '2');

    const fetchedSections: string[] = [];
    const res1 = await runTitleEnrichmentBatch({
      dataRepoPath: repo,
      uscTitle: '18',
      sources: ['ecfr'],
      onlyMissing: true,
      offset: 0,
      limit: 2,
      delayMs: 10,
      sleepFn: async () => {},
      fetchEcfr: async ({ uscTitle, section }) => {
        fetchedSections.push(section);
        return makeEcfrSuccess(uscTitle, section);
      },
    });
    expect(res1.ok).toBe(true);
    if (!res1.ok) return;
    expect(fetchedSections).toEqual(['10', '111']);
    expect(res1.value.writtenCount).toBe(2);
    expect(res1.value.coverageAfter.report.sources.ecfr.completedCount).toBe(4);

    // Resuming with identical --only-missing --limit 2 picks up remaining section 1001
    fetchedSections.length = 0;
    const res2 = await runTitleEnrichmentBatch({
      dataRepoPath: repo,
      uscTitle: '18',
      sources: ['ecfr'],
      onlyMissing: true,
      offset: 0,
      limit: 2,
      sleepFn: async () => {},
      fetchEcfr: async ({ uscTitle, section }) => {
        fetchedSections.push(section);
        return makeEcfrSuccess(uscTitle, section);
      },
    });
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    expect(fetchedSections).toEqual(['1001']);
    expect(res2.value.coverageAfter.report.sources.ecfr.coverageState).toBe('complete');
  });

  it('clamps delayMs < 500 to MIN_POLITE_DELAY_MS while allowing zero-wait sleep injection in tests', async () => {
    expect(MIN_POLITE_DELAY_MS).toBe(500);
    expect(clampPoliteDelayMs(undefined)).toBe(500);
    expect(clampPoliteDelayMs(0)).toBe(500);
    expect(clampPoliteDelayMs(250)).toBe(500);
    expect(clampPoliteDelayMs(-50)).toBe(500);
    expect(clampPoliteDelayMs(1200)).toBe(1200);

    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '26', '1', '1');
    await writeStatuteFixture(repo, '26', '1', '2');

    const observedSleeps: number[] = [];
    const res = await runTitleEnrichmentBatch({
      dataRepoPath: repo,
      uscTitle: '26',
      sources: ['ecfr'],
      delayMs: 25,
      sleepFn: async (ms) => {
        observedSleeps.push(ms);
      },
      fetchEcfr: async ({ uscTitle, section }) => makeEcfrSuccess(uscTitle, section),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.effectiveDelayMs).toBe(500);
    expect(observedSleeps).toEqual([500]);
  });

  it('dryRun writes zero files and executes zero fetch calls', async () => {
    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '18', '47', '1001');
    await writeStatuteFixture(repo, '18', '7', '111');

    const fetchEcfr = vi.fn();
    const fetchCourtListener = vi.fn();
    const sleepFn = vi.fn();

    const res = await runTitleEnrichmentBatch({
      dataRepoPath: repo,
      uscTitle: '18',
      sources: ['ecfr', 'courtlistener'],
      dryRun: true,
      fetchEcfr,
      fetchCourtListener,
      sleepFn,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(fetchEcfr).not.toHaveBeenCalled();
    expect(fetchCourtListener).not.toHaveBeenCalled();
    expect(sleepFn).not.toHaveBeenCalled();
    expect(res.value.writtenCount).toBe(0);
    expect(res.value.selectedCount).toBe(2);
    expect(existsSync(join(repo, 'regulations'))).toBe(false);
    expect(existsSync(join(repo, 'annotations'))).toBe(false);
  });

  it('circuit breaker halts cleanly after maxConsecutiveRateLimits while preserving prior validated sidecars', async () => {
    expect(DEFAULT_MAX_CONSECUTIVE_RATE_LIMITS).toBe(3);

    const repo = await createTempRepo();
    for (const sec of ['1', '2', '3', '4', '5']) {
      await writeStatuteFixture(repo, '18', '1', sec);
    }
    const existingRegPath = await writeValidRegSidecar(repo, '18', '2', 'Preserved Prior Agency');
    const priorContentBefore = await readFile(existingRegPath, 'utf-8');

    const calls: string[] = [];
    const res = await runTitleEnrichmentBatch({
      dataRepoPath: repo,
      uscTitle: '18',
      sources: ['ecfr'],
      onlyMissing: false,
      sleepFn: async () => {},
      fetchEcfr: async ({ uscTitle, section, priorSnapshot }) => {
        calls.push(section);
        if (section === '1') {
          return makeEcfrSuccess(uscTitle, section, 'Fresh Section 1 Agency');
        }
        return makeEcfrRateLimited(uscTitle, section, priorSnapshot);
      },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Section 1 succeeds (written), sections 2, 3, 4 hit 429 -> circuit breaker halts before section 5
    expect(calls).toEqual(['1', '2', '3', '4']);
    expect(res.value.haltedByCircuitBreaker).toBe(true);
    expect(res.value.writtenCount).toBe(1);
    expect(res.value.failedCount).toBe(3);
    expect(existsSync(join(repo, 'regulations', 'title-18', 'section-1.json'))).toBe(true);
    expect(existsSync(join(repo, 'regulations', 'title-18', 'section-3.json'))).toBe(false);
    // Existing valid sidecar for section 2 MUST NOT be overwritten on failure
    expect(await readFile(existingRegPath, 'utf-8')).toBe(priorContentBefore);
  });

  it('never overwrites existing valid YAML sidecar on failed CourtListener fetch', async () => {
    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '18', '7', '111');
    const yamlPath = await writeValidAnnotationSidecar(repo, '18', '111', 'United States v. Feola');
    const beforeYaml = await readFile(yamlPath, 'utf-8');

    const res = await runTitleEnrichmentBatch({
      dataRepoPath: repo,
      uscTitle: '18',
      sources: ['courtlistener'],
      onlyMissing: false,
      sleepFn: async () => {},
      fetchCourtListener: async ({ uscTitle, section, priorAnnotation }) => ({
        status: 'failed',
        source: 'courtlistener',
        scope: `${uscTitle} U.S.C. ${section}`,
        observedAt: FIXED_NOW,
        data: priorAnnotation ?? {
          targetSection: `${uscTitle} U.S.C. ${section}`,
          lastSyncedET: FIXED_NOW,
          cases: [],
        },
        retainedPriorSnapshot: priorAnnotation !== null,
        isStale: true,
        failureKind: 'http_error',
        errorMessage: 'HTTP 503 Service Unavailable',
      }),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.failedCount).toBe(1);
    expect(await readFile(yamlPath, 'utf-8')).toBe(beforeYaml);
  });

  it('writes validated CourtListener YAML sidecars on successful fetch', async () => {
    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '10', '1', '101');

    const res = await runTitleEnrichmentBatch({
      dataRepoPath: repo,
      uscTitle: '10',
      sources: ['courtlistener'],
      sleepFn: async () => {},
      fetchCourtListener: async ({ uscTitle, section }) =>
        makeCourtListenerSuccess(uscTitle, section),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.writtenCount).toBe(1);
    const outYaml = await readFile(
      join(repo, 'annotations', 'title-10', 'section-101.yaml'),
      'utf-8'
    );
    expect(outYaml).toContain('targetSection: "10 U.S.C. 101"');
    expect(outYaml).toContain('caseName: "United States v. Sample"');
  });

  it('maintains parity between buildTitleCoverageRecords and computeTitleEnrichmentCoverage', async () => {
    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '18', '1', '2');
    await writeStatuteFixture(repo, '18', '47', '1001');
    await writeValidRegSidecar(repo, '18', '1001');

    const directRes = await computeTitleEnrichmentCoverage({
      dataRepoPath: repo,
      uscTitle: '18',
      releaseId: 'pl-119-73',
      observedAt: FIXED_NOW,
    });
    const sliceRes = await buildTitleCoverageRecords({
      dataRepoPath: repo,
      uscTitle: '18',
      releaseId: 'pl-119-73',
      observedAt: FIXED_NOW,
    });

    expect(directRes.ok).toBe(true);
    expect(sliceRes.ok).toBe(true);
    if (!directRes.ok || !sliceRes.ok) return;
    expect(sliceRes.value).toEqual(directRes.value.coverages);

    const catalog = new CanonicalWorkbenchCatalog();
    const ingest = catalog.ingestBundle({ coverages: sliceRes.value });
    expect(ingest.ok).toBe(true);
  });

  it('CLI supports --dry-run without COURTLISTENER_API_TOKEN and fails closed in live courtlistener mode without token', async () => {
    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '18', '47', '1001');
    const coverageOut = join(repo, 'coverage-out.json');

    const prevToken = process.env['COURTLISTENER_API_TOKEN'];
    delete process.env['COURTLISTENER_API_TOKEN'];

    try {
      const dryRunCode = await runEnrichTitleCli([
        '--title',
        '18',
        '--data-repo',
        repo,
        '--sources',
        'ecfr,courtlistener',
        '--dry-run',
        '--coverage-out',
        coverageOut,
      ]);
      expect(dryRunCode).toBe(0);
      expect(existsSync(coverageOut)).toBe(true);

      const liveNoTokenCode = await runEnrichTitleCli([
        '--title',
        '18',
        '--data-repo',
        repo,
        '--sources',
        'courtlistener',
      ]);
      expect(liveNoTokenCode).toBe(1);
    } finally {
      if (prevToken !== undefined) {
        process.env['COURTLISTENER_API_TOKEN'] = prevToken;
      } else {
        delete process.env['COURTLISTENER_API_TOKEN'];
      }
    }
  });

  it('reports failed coverage on malformed sidecars and handles non-consecutive 429s and thrown fetch errors safely', async () => {
    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '18', '1', '1');
    await writeStatuteFixture(repo, '18', '1', '2');
    await writeStatuteFixture(repo, '18', '1', '3');
    await writeStatuteFixture(repo, '18', '1', '4');

    const regDir = join(repo, 'regulations', 'title-18');
    await mkdir(regDir, { recursive: true });
    await writeFile(join(regDir, 'section-1.json'), '{not-valid-json', 'utf-8');
    const priorPath = await writeValidRegSidecar(repo, '18', '2', 'Prior Valid Agency');
    const priorContent = await readFile(priorPath, 'utf-8');

    const covRes = await computeTitleEnrichmentCoverage({
      dataRepoPath: repo,
      uscTitle: '18',
      observedAt: FIXED_NOW,
    });
    expect(covRes.ok).toBe(true);
    if (!covRes.ok) return;
    expect(covRes.value.report.sources.ecfr.coverageState).toBe('partial');
    expect(covRes.value.report.sources.ecfr.failedPartitions).toHaveLength(1);

    // 429, throw, 200 (resets streak), 429 -> should NOT trip default circuit breaker of 3
    const res = await runTitleEnrichmentBatch({
      dataRepoPath: repo,
      uscTitle: '18',
      sources: ['ecfr'],
      onlyMissing: false,
      sleepFn: async () => {},
      fetchEcfr: async ({ uscTitle, section, priorSnapshot }) => {
        if (section === '1') return makeEcfrRateLimited(uscTitle, section, priorSnapshot);
        if (section === '2') throw new Error('Simulated socket hang up');
        if (section === '3') return makeEcfrSuccess(uscTitle, section);
        return makeEcfrRateLimited(uscTitle, section, priorSnapshot);
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.haltedByCircuitBreaker).toBe(false);
    expect(res.value.writtenCount).toBe(1);
    expect(res.value.failedCount).toBe(3);
    expect(await readFile(priorPath, 'utf-8')).toBe(priorContent);
  });
});

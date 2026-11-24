import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
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
  runTitleEnrichmentBatch,
} from '../lib/title-enrichment-batch.js';
import { runEnrichTitleCli } from '../enrich-title.js';

const FIXED_NOW = '2026-11-24T04:00:00.000Z';

async function writeStatuteFixture(dataRepoPath: string, uscTitle: string, chapter: string, section: string): Promise<void> {
  const dir = join(dataRepoPath, 'statutes', `title-${uscTitle}`, `chapter-${chapter}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `section-${section}.md`), `---\ntitle: "Section ${section}"\nusc_title: "${uscTitle}"\nusc_section: "${section}"\nchapter: ${chapter}\n---\n\nText for ${uscTitle} U.S.C. ${section}.\n`, 'utf-8');
}

async function writeValidRegSidecar(dataRepoPath: string, uscTitle: string, section: string, agency = 'Test Agency'): Promise<string> {
  const dir = join(dataRepoPath, 'regulations', `title-${uscTitle}`);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `section-${section}.json`);
  const payload = SectionRegulationsSchema.parse({
    targetSection: `${uscTitle}-${section}`, lastUpdated: FIXED_NOW,
    refreshStatus: { source: 'ecfr', scope: `${uscTitle} U.S.C. ${section}`, status: 'success-nonempty', observedAt: FIXED_NOW, lastSuccessAt: FIXED_NOW, retainedPriorSnapshot: false, isStale: false },
    regulations: [{ cfrTitle: 19, cfrPart: 162, agency, ecfrUrl: 'https://www.ecfr.gov/current/title-19/part-162', extractionState: 'candidate', editorialReview: 'unreviewed', relationshipType: 'text_match_candidate' }],
  });
  await writeFile(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  return filePath;
}

async function writeValidAnnotationSidecar(dataRepoPath: string, uscTitle: string, section: string, caseName = 'United States v. Test'): Promise<string> {
  const dir = join(dataRepoPath, 'annotations', `title-${uscTitle}`);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `section-${section}.yaml`);
  await writeFile(filePath, [
    `targetSection: "${uscTitle} U.S.C. ${section}"`, `lastSyncedET: "${FIXED_NOW}"`, 'cases:',
    `  - caseName: "${caseName}"`, '    citation: "522 U.S. 398"', '    court: "SCOTUS"',
    '    date: "1998-01-26"', '    holdingSummary: "Test excerpt."',
    '    sourceUrl: "https://www.courtlistener.com/opinion/118168/brogan-v-united-states/"', '    impact: "unverified_mention"',
  ].join('\n') + '\n', 'utf-8');
  return filePath;
}

function makeEcfrSuccess(uscTitle: string, section: string, agency = 'Mock Agency'): SourceAcquisitionOutcome<ImplementingRegulation[]> {
  return {
    status: 'success-nonempty', source: 'ecfr', scope: `${uscTitle} U.S.C. ${section}`, observedAt: FIXED_NOW, lastSuccessAt: FIXED_NOW,
    data: [{ cfrTitle: 28, cfrPart: 50, agency, ecfrUrl: 'https://www.ecfr.gov/current/title-28/part-50', extractionState: 'candidate', editorialReview: 'unreviewed', relationshipType: 'text_match_candidate' }],
    retainedPriorSnapshot: false, isStale: false, completedPages: 1, expectedPages: 1,
  };
}

function makeEcfrRateLimited(uscTitle: string, section: string, prior: { data: ImplementingRegulation[]; lastSuccessAt: string } | null): SourceAcquisitionOutcome<ImplementingRegulation[]> {
  return {
    status: 'failed', source: 'ecfr', scope: `${uscTitle} U.S.C. ${section}`, observedAt: FIXED_NOW, lastSuccessAt: prior?.lastSuccessAt,
    data: prior?.data ?? [], retainedPriorSnapshot: prior !== null, isStale: true, httpStatus: 429, failureKind: 'rate_limited', errorMessage: 'eCFR search API returned HTTP 429',
  };
}

function makeCourtListenerSuccess(uscTitle: string, section: string): SourceAcquisitionOutcome<PrecedentAnnotation> {
  return {
    status: 'success-nonempty', source: 'courtlistener', scope: `${uscTitle} U.S.C. ${section}`, observedAt: FIXED_NOW, lastSuccessAt: FIXED_NOW,
    data: PrecedentAnnotationSchema.parse({
      targetSection: `${uscTitle} U.S.C. ${section}`, lastSyncedET: FIXED_NOW,
      cases: [{ caseName: 'United States v. Sample', citation: '100 F.4th 1', court: 'Appellate', date: '2024-05-01', holdingSummary: 'Sample snippet.', retrievalExcerpt: 'Sample snippet.', retrievalQuery: `"${uscTitle} U.S.C. ${section}"`, retrievedAt: FIXED_NOW, extractionState: 'candidate', editorialReview: 'unreviewed', versionAlignmentState: 'unknown', sourceUrl: 'https://www.courtlistener.com/opinion/99999/sample/', impact: 'unverified_mention' }],
    }),
    retainedPriorSnapshot: false, isStale: false,
  };
}

describe('title-enrichment-batch (resumable batch runner & CLI)', () => {
  const tempDirs: string[] = [];
  async function createTempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'usct-title-batch-'));
    tempDirs.push(dir);
    await mkdir(join(dir, 'statutes'), { recursive: true });
    return dir;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0, tempDirs.length)) await rm(dir, { recursive: true, force: true });
  });

  it('supports resumable --only-missing slicing with offset and limit', async () => {
    const repo = await createTempRepo();
    for (const sec of ['1', '2', '10', '111', '1001']) await writeStatuteFixture(repo, '18', '1', sec);
    await writeValidRegSidecar(repo, '18', '1');
    await writeValidRegSidecar(repo, '18', '2');

    const fetched: string[] = [];
    const res1 = await runTitleEnrichmentBatch({
      dataRepoPath: repo, uscTitle: '18', sources: ['ecfr'], onlyMissing: true, offset: 0, limit: 2, sleepFn: async () => {},
      fetchEcfr: async ({ uscTitle, section }) => { fetched.push(section); return makeEcfrSuccess(uscTitle, section); },
    });
    expect(res1.ok).toBe(true);
    if (!res1.ok) return;
    expect(fetched).toEqual(['10', '111']);
    expect(res1.value.writtenCount).toBe(2);
    expect(res1.value.coverageAfter.report.sources.ecfr.completedCount).toBe(4);

    fetched.length = 0;
    const res2 = await runTitleEnrichmentBatch({
      dataRepoPath: repo, uscTitle: '18', sources: ['ecfr'], onlyMissing: true, offset: 0, limit: 2, sleepFn: async () => {},
      fetchEcfr: async ({ uscTitle, section }) => { fetched.push(section); return makeEcfrSuccess(uscTitle, section); },
    });
    expect(res2.ok && res2.value.coverageAfter.report.sources.ecfr.coverageState === 'complete').toBe(true);
    expect(fetched).toEqual(['1001']);
  });

  it('retries partial CourtListener results without counting them as completed sidecars', async () => {
    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '18', '47', '1001');
    const annotationPath = join(repo, 'annotations', 'title-18', 'section-1001.yaml');
    const fetchCourtListener = vi.fn(async ({ uscTitle, section }: { uscTitle: string; section: string }) => ({
      ...makeCourtListenerSuccess(uscTitle, section),
      status: 'partial' as const, isStale: true, completedPages: 1, expectedPages: 2,
    }));
    const options = {
      dataRepoPath: repo, uscTitle: '18', sources: ['courtlistener'] as const,
      onlyMissing: true, sleepFn: async () => {}, fetchCourtListener,
    };
    const partial = await runTitleEnrichmentBatch(options);
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.value.failedCount).toBe(1);
    expect(partial.value.coverageAfter.report.sources.courtlistener.completedCount).toBe(0);
    expect(partial.value.writtenCount).toBe(0);
    expect(existsSync(annotationPath)).toBe(false);

    const retryFetcher = vi.fn(async ({ uscTitle, section }: { uscTitle: string; section: string }) =>
      makeCourtListenerSuccess(uscTitle, section));
    const retry = await runTitleEnrichmentBatch({ ...options, fetchCourtListener: retryFetcher });
    expect(retry.ok && retry.value.coverageAfter.report.sources.courtlistener.completedCount).toBe(1);
    expect(retryFetcher).toHaveBeenCalledOnce();
    expect(retryFetcher.mock.calls[0]?.[0]).toMatchObject({ section: '1001', priorAnnotation: null });
    const completed = await readFile(annotationPath, 'utf-8');
    const skipped = await runTitleEnrichmentBatch({ ...options, fetchCourtListener: retryFetcher });
    expect(skipped.ok && skipped.value.selectedCount).toBe(0);
    expect(retryFetcher).toHaveBeenCalledOnce();

    const refresh = await runTitleEnrichmentBatch({ ...options, onlyMissing: false });
    expect(refresh.ok && refresh.value.failedCount).toBe(1);
    expect(await readFile(annotationPath, 'utf-8')).toBe(completed);
  });

  it.each(['accepted', 'disputed', 'superseded'] as const)('preserves %s annotations on successful and empty CourtListener refreshes', async (editorialReview) => {
    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '18', '47', '1001');
    const annotationPath = await writeValidAnnotationSidecar(repo, '18', '1001');
    const original = (await readFile(annotationPath, 'utf-8')).replace('holdingSummary: "Test excerpt."',
      "holdingSummary: 'The court stated: this provision applies to the defendant''s conduct\n      and requires knowing acts.'") +
      `    extractionState: "verified"\n    editorialReview: "${editorialReview}"\n    reviewedProposition: "Reviewed legal proposition."\n`;
    await writeFile(annotationPath, original);
    const unusedFetcher = vi.fn(async () => makeCourtListenerSuccess('18', '1001'));
    const skipped = await runTitleEnrichmentBatch({ dataRepoPath: repo, uscTitle: '18', sources: ['courtlistener'], fetchCourtListener: unusedFetcher });
    expect(skipped.ok && skipped.value.selectedCount).toBe(0);
    expect(unusedFetcher).not.toHaveBeenCalled();
    for (const empty of [false, true]) {
      const result = await runTitleEnrichmentBatch({
        dataRepoPath: repo, uscTitle: '18', sources: ['courtlistener'], onlyMissing: false,
        fetchCourtListener: async ({ uscTitle, section }) => {
          const outcome = makeCourtListenerSuccess(uscTitle, section);
          return empty ? { ...outcome, status: 'success-empty', data: { ...outcome.data, cases: [] } } : outcome;
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.writtenCount).toBe(0);
      expect(result.value.failedCount).toBe(1);
      expect(await readFile(annotationPath, 'utf-8')).toBe(original);
    }
  });

  it.each(['comment', 'partial', 'failed', 'malformed'])('preserves existing annotations with %s content that cannot be used as a prior snapshot', async (kind) => {
    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '18', '47', '1001');
    const annotationPath = await writeValidAnnotationSidecar(repo, '18', '1001');
    let original = (await readFile(annotationPath, 'utf-8')) + '    extractionState: verified\n    editorialReview: accepted\n';
    if (kind === 'comment') original = '# reviewed by editor\n' + original;
    else if (kind === 'malformed') original = 'cases: [unterminated\n';
    else original += `refreshStatus:\n  source: courtlistener\n  scope: 18 U.S.C. 1001\n  status: ${kind}\n  observedAt: ${FIXED_NOW}\n  retainedPriorSnapshot: false\n  isStale: true\n`;
    await writeFile(annotationPath, original);
    const result = await runTitleEnrichmentBatch({
      dataRepoPath: repo, uscTitle: '18', sources: ['courtlistener'],
      fetchCourtListener: async () => makeCourtListenerSuccess('18', '1001'),
    });
    expect(result.ok && result.value.writtenCount).toBe(0);
    expect(result.ok && result.value.failedCount).toBe(1);
    expect(await readFile(annotationPath, 'utf-8')).toBe(original);
  });

  it('preserves reviewed eCFR sidecars on successful and empty refreshes', async () => {
    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '18', '47', '1001');
    const regPath = await writeValidRegSidecar(repo, '18', '1001');
    const prior = SectionRegulationsSchema.parse(JSON.parse(await readFile(regPath, 'utf-8')));
    prior.regulations = prior.regulations.map((r) => ({ ...r, extractionState: 'verified', editorialReview: 'accepted', relationshipType: 'authority_citation', verifiedAuthorityText: '18 U.S.C. 1001' }));
    const original = JSON.stringify(prior);
    await writeFile(regPath, original);
    for (const empty of [false, true]) {
      const result = await runTitleEnrichmentBatch({
        dataRepoPath: repo, uscTitle: '18', sources: ['ecfr'], onlyMissing: false,
        fetchEcfr: async () => {
          const outcome = makeEcfrSuccess('18', '1001');
          return empty ? { ...outcome, status: 'success-empty', data: [] } : outcome;
        },
      });
      expect(result.ok && result.value.writtenCount).toBe(0);
      expect(result.ok && result.value.failedCount).toBe(1);
      expect(await readFile(regPath, 'utf-8')).toBe(original);
    }
  });

  it.each(['symlink', 'hardlink'])('refuses %s annotation targets without modifying the linked file', async (kind) => {
    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '18', '47', '1001');
    const target = await writeValidAnnotationSidecar(repo, '18', '2', 'Linked content');
    const original = await readFile(target, 'utf-8');
    const output = join(repo, 'annotations', 'title-18', 'section-1001.yaml');
    if (kind === 'symlink') await symlink(target, output);
    else await link(target, output);
    const result = await runTitleEnrichmentBatch({
      dataRepoPath: repo, uscTitle: '18', sources: ['courtlistener'], onlyMissing: false,
      fetchCourtListener: async () => makeCourtListenerSuccess('18', '1001'),
    });
    expect(result.ok && result.value.writtenCount).toBe(0);
    expect(result.ok && result.value.failedCount).toBe(1);
    expect(await readFile(target, 'utf-8')).toBe(original);
  });

  it('clamps delayMs < 500 to MIN_POLITE_DELAY_MS and skips network calls during dryRun', async () => {
    expect(MIN_POLITE_DELAY_MS).toBe(500);
    expect(clampPoliteDelayMs(undefined)).toBe(500);
    expect(clampPoliteDelayMs(0)).toBe(500);
    expect(clampPoliteDelayMs(1200)).toBe(1200);

    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '26', '1', '1');
    await writeStatuteFixture(repo, '26', '1', '2');

    const fetchEcfr = vi.fn();
    const sleepFn = vi.fn(async () => {});
    const dry = await runTitleEnrichmentBatch({ dataRepoPath: repo, uscTitle: '26', sources: ['ecfr'], dryRun: true, fetchEcfr, sleepFn });
    expect(dry.ok && dry.value.selectedCount === 2 && dry.value.writtenCount === 0).toBe(true);
    expect(fetchEcfr).not.toHaveBeenCalled();
    expect(sleepFn).not.toHaveBeenCalled();
    expect(existsSync(join(repo, 'regulations'))).toBe(false);

    const sleeps: number[] = [];
    const live = await runTitleEnrichmentBatch({
      dataRepoPath: repo, uscTitle: '26', sources: ['ecfr'], delayMs: 25,
      sleepFn: async (ms) => { sleeps.push(ms); },
      fetchEcfr: async ({ uscTitle, section }) => makeEcfrSuccess(uscTitle, section),
    });
    expect(live.ok && live.value.effectiveDelayMs === 500).toBe(true);
    expect(sleeps).toEqual([500]);
  });

  it('halts cleanly on consecutive 429s while preserving prior sidecars and passing parsed priorAnnotation to CourtListener', async () => {
    expect(DEFAULT_MAX_CONSECUTIVE_RATE_LIMITS).toBe(3);
    const repo = await createTempRepo();
    for (const sec of ['1', '2', '3', '4', '5']) await writeStatuteFixture(repo, '18', '1', sec);
    const reg2 = await writeValidRegSidecar(repo, '18', '2', 'Preserved Prior Agency');
    const reg2Before = await readFile(reg2, 'utf-8');
    const ann2 = await writeValidAnnotationSidecar(repo, '18', '2', 'United States v. Feola');
    const ann2Before = await readFile(ann2, 'utf-8');

    const calls: string[] = [];
    const res429 = await runTitleEnrichmentBatch({
      dataRepoPath: repo, uscTitle: '18', sources: ['ecfr'], onlyMissing: false, sleepFn: async () => {},
      fetchEcfr: async ({ uscTitle, section, priorSnapshot }) => {
        calls.push(section);
        return section === '1' ? makeEcfrSuccess(uscTitle, section) : makeEcfrRateLimited(uscTitle, section, priorSnapshot);
      },
    });
    expect(res429.ok).toBe(true);
    if (!res429.ok) return;
    expect(calls).toEqual(['1', '2', '3', '4']);
    expect(res429.value.haltedByCircuitBreaker).toBe(true);
    expect(res429.value.failedCount).toBe(3);
    expect(await readFile(reg2, 'utf-8')).toBe(reg2Before);

    let receivedPrior: PrecedentAnnotation | null = null;
    const clRes = await runTitleEnrichmentBatch({
      dataRepoPath: repo, uscTitle: '18', sources: ['courtlistener'], onlyMissing: false, limit: 1, offset: 1, sleepFn: async () => {},
      fetchCourtListener: async ({ uscTitle, section, priorAnnotation }) => {
        receivedPrior = priorAnnotation;
        return {
          status: 'failed', source: 'courtlistener', scope: `${uscTitle} U.S.C. ${section}`,
          observedAt: FIXED_NOW, data: priorAnnotation ?? { targetSection: `${uscTitle} U.S.C. ${section}`, lastSyncedET: FIXED_NOW, cases: [] },
          retainedPriorSnapshot: priorAnnotation !== null, isStale: true, failureKind: 'http_error', errorMessage: 'HTTP 503',
        };
      },
    });
    expect(clRes.ok && clRes.value.failedCount === 1).toBe(true);
    expect(receivedPrior).not.toBeNull();
    expect((receivedPrior as PrecedentAnnotation | null)?.cases[0]?.caseName).toBe('United States v. Feola');
    expect(await readFile(ann2, 'utf-8')).toBe(ann2Before);
  });

  it('writes validated CourtListener YAML sidecars, isolates thrown errors, and returns non-zero CLI exit code on HTTP 503', async () => {
    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '10', '1', '101');
    const okYaml = await runTitleEnrichmentBatch({
      dataRepoPath: repo, uscTitle: '10', sources: ['courtlistener'], sleepFn: async () => {},
      fetchCourtListener: async ({ uscTitle, section }) => makeCourtListenerSuccess(uscTitle, section),
    });
    expect(okYaml.ok && okYaml.value.writtenCount === 1).toBe(true);
    const writtenYaml = await readFile(join(repo, 'annotations', 'title-10', 'section-101.yaml'), 'utf-8');
    expect(writtenYaml).toContain('targetSection: "10 U.S.C. 101"');

    await writeStatuteFixture(repo, '18', '47', '1001');
    const regDir = join(repo, 'regulations', 'title-18');
    await mkdir(regDir, { recursive: true });
    await writeFile(join(regDir, 'section-1001.json'), '{bad', 'utf-8');
    const covBad = await computeTitleEnrichmentCoverage({ dataRepoPath: repo, uscTitle: '18', observedAt: FIXED_NOW });
    expect(covBad.ok && covBad.value.report.sources.ecfr.coverageState === 'failed').toBe(true);

    const prevToken = process.env['COURTLISTENER_API_TOKEN'];
    delete process.env['COURTLISTENER_API_TOKEN'];
    try {
      const coverageOut = join(repo, 'cov.json');
      expect(await runEnrichTitleCli(['--title', '18', '--data-repo', repo, '--dry-run', '--coverage-out', coverageOut])).toBe(0);
      expect(existsSync(coverageOut)).toBe(true);
      expect(await runEnrichTitleCli(['--title', '18', '--data-repo', repo, '--sources', 'courtlistener'])).toBe(1);

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' }));
      expect(await runEnrichTitleCli(['--title', '18', '--data-repo', repo, '--sources', 'ecfr', '--limit', '1'])).toBe(1);
    } finally {
      if (prevToken !== undefined) process.env['COURTLISTENER_API_TOKEN'] = prevToken;
      else delete process.env['COURTLISTENER_API_TOKEN'];
    }
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { TokenBucket } from '../../packages/shared/src/index.js';
import { processReleasePoint, type ImportMetrics } from '../import-history.js';
import {
  loadState,
  gitRevParse,
  shouldProcessReleaseOnResume,
  publishImmutableReleaseTag,
  gitCommit,
  type TitleFetch,
} from '../lib/import-helpers.js';
import {
  parseReleasePointStr,
  scrapeReleasePoints,
  type ReleasePointId,
} from '../lib/release-points.js';
import { findGapsBetweenTags } from '../generate-diffs.js';

const execFileAsync = promisify(execFile);

function makeUslmXml(sectionText: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<lawDoc xmlns="http://xml.house.gov/schemas/uslm/1.0">
  <title identifier="/us/usc/t18">
    <num value="18">Title 18</num>
    <heading>CRIMES AND CRIMINAL PROCEDURE</heading>
    <chapter identifier="/us/usc/t18/ch7">
      <num value="7">CHAPTER 7</num>
      <heading>ASSAULT</heading>
      <section identifier="/us/usc/t18/s111">
        <num value="111">§ 111.</num>
        <heading>Assaulting, resisting, or impeding certain officers or employees</heading>
        <subsection identifier="/us/usc/t18/s111/a">
          <num value="a">(a)</num>
          <content>${sectionText}</content>
        </subsection>
      </section>
    </chapter>
  </title>
</lawDoc>`;
}

describe('USCT-005 & USCT-006: Middle-release resume ledger & immutable release identities', () => {
  let repoDir = '';

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'usct-005-006-'));
    await execFileAsync('git', ['init'], { cwd: repoDir });
    await execFileAsync('git', ['config', 'user.email', 'test@civic-source.org'], { cwd: repoDir });
    await execFileAsync('git', ['config', 'user.name', 'Civic Source Test'], { cwd: repoDir });
    await writeFile(join(repoDir, 'README.md'), '# Test US Code Repo\n', 'utf-8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'chore: init'], { cwd: repoDir });
  });

  afterEach(async () => {
    if (repoDir) {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  it('USCT-005: R1 succeeds, R2 fails, R3 succeeds -> R2 remains retryable on resume and R1/R3 are not re-imported', async () => {
    const r1: ReleasePointId = { congress: 119, law: 1, lawSegment: '1', label: 'PL 119-1' };
    const r2: ReleasePointId = { congress: 119, law: 2, lawSegment: '2', label: 'PL 119-2' };
    const r3: ReleasePointId = { congress: 119, law: 3, lawSegment: '3', label: 'PL 119-3' };

    const rateLimiter = new TokenBucket({ capacity: 10, refillRate: 10, refillIntervalMs: 10 });
    const metrics: ImportMetrics = {
      releasePointsProcessed: 0,
      titlesChanged: 0,
      sectionsChanged: 0,
      startTime: performance.now(),
    };

    let r2ShouldFail = true;
    const fetchCalls: string[] = [];

    const mockFetcher = async (rp: ReleasePointId, paddedTitle: string): Promise<TitleFetch> => {
      fetchCalls.push(`${rp.label}:${paddedTitle}`);
      if (rp.law === 2 && r2ShouldFail) {
        return { kind: 'failed', reason: 'HTTP 503 transient failure on PL 119-2' };
      }
      return {
        kind: 'ok',
        xml: makeUslmXml(`Statutory text as amended by ${rp.label}.`),
      };
    };

    const state = await loadState(repoDir);
    const titlesToProcess = ['18'];

    // Run 1: R1 succeeds, R2 fails, R3 succeeds
    const res1 = await processReleasePoint(r1, state, rateLimiter, metrics, 3, {
      repoPath: repoDir,
      titlesToProcess,
      dryRun: false,
      fetcherFn: mockFetcher,
      interTitleDelayMs: 0,
    });
    expect(res1.failedTitles).toBe(0);

    const res2 = await processReleasePoint(r2, state, rateLimiter, metrics, 3, {
      repoPath: repoDir,
      titlesToProcess,
      dryRun: false,
      fetcherFn: mockFetcher,
      interTitleDelayMs: 0,
    });
    expect(res2.failedTitles).toBe(1);

    const res3 = await processReleasePoint(r3, state, rateLimiter, metrics, 3, {
      repoPath: repoDir,
      titlesToProcess,
      dryRun: false,
      fetcherFn: mockFetcher,
      interTitleDelayMs: 0,
    });
    expect(res3.failedTitles).toBe(0);

    // Verify ledger after Run 1:
    // - R1 and R3 tags exist; R2 tag was NEVER created because R2 had failedTitles > 0
    const persistedAfterRun1 = await loadState(repoDir);
    expect(persistedAfterRun1.releaseLedger?.['119-1']?.status).toBe('complete');
    expect(persistedAfterRun1.releaseLedger?.['119-2']?.status).toBe('failed');
    expect(persistedAfterRun1.releaseLedger?.['119-3']?.status).toBe('complete');
    expect(persistedAfterRun1.incompleteReleases).toEqual(['119-2']);

    expect(await gitRevParse(repoDir, 'pl-119-1')).not.toBeNull();
    expect(await gitRevParse(repoDir, 'pl-119-2')).toBeNull();
    expect(await gitRevParse(repoDir, 'pl-119-3')).not.toBeNull();

    // Comparisons spanning R1..R3 explicitly detect the missing R2 gap
    expect(findGapsBetweenTags('pl-119-1', 'pl-119-3', persistedAfterRun1.incompleteReleases ?? [])).toEqual([
      '119-2',
    ]);

    // Check resume filter: R1 and R3 are skipped; ONLY R2 is selected for retry!
    const pointsToRetry = [r1, r2, r3].filter((p) =>
      shouldProcessReleaseOnResume(p, persistedAfterRun1, titlesToProcess)
    );
    expect(pointsToRetry.map((p) => p.label)).toEqual(['PL 119-2']);

    // Run 2 (--resume): R2 now succeeds
    fetchCalls.length = 0;
    r2ShouldFail = false;
    const retryRes = await processReleasePoint(r2, persistedAfterRun1, rateLimiter, metrics, 1, {
      repoPath: repoDir,
      titlesToProcess,
      dryRun: false,
      fetcherFn: mockFetcher,
      interTitleDelayMs: 0,
    });
    expect(retryRes.failedTitles).toBe(0);
    expect(fetchCalls).toEqual(['PL 119-2:18']); // Only R2 was fetched

    const persistedAfterRun2 = await loadState(repoDir);
    expect(persistedAfterRun2.releaseLedger?.['119-2']?.status).toBe('complete');
    expect(persistedAfterRun2.incompleteReleases).toEqual([]);
    expect(await gitRevParse(repoDir, 'pl-119-2')).not.toBeNull();
  }, 15_000);

  it('USCT-006: preserves exclusion-bearing release point identifiers (e.g., 119/73not60) without collapsing to numeric law', async () => {
    const parsed = parseReleasePointStr('pl/119/73not60');
    expect(parsed).toEqual({
      congress: 119,
      law: 73,
      lawSegment: '73not60',
      exclusions: ['60'],
      label: 'PL 119-73not60',
    });

    const html = `
      <a href="/download/releasepoints/us/pl/119/73not60/usc-rp@119-73not60.htm">PL 119-73not60</a>
      <a href="/download/releasepoints/us/pl/119/73/usc-rp@119-73.htm">PL 119-73</a>
    `;
    const scraped = await scrapeReleasePoints(async () => new Response(html, { status: 200 }));
    expect(scraped.map((p) => p.label)).toEqual(['PL 119-73not60', 'PL 119-73']);

    const modernHtml = `
      <li class="releasepoint"><a class="releasepoint" href="download/119-102not101.html">Public Law 119-102not101 (July 12, 2026), except 119-101.</a></li>
      <li class="releasepoint"><a class="releasepoint" href="download/119-138.html">Public Law 119-138 (November 3, 2026).</a></li>
    `;
    const modernScraped = await scrapeReleasePoints(async (url) => {
      const target = String(url);
      if (target.endsWith('/priorreleasepoints.html')) {
        return new Response(modernHtml, { status: 200 });
      }
      if (target.endsWith('/download.html')) {
        return new Response('<h3 class="releasepointinformation">Public Law 119-142</h3><p>Current through Public Law 119-142 (November 10, 2026).</p>', { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });
    expect(modernScraped.map((p) => p.label)).toEqual([
      'PL 119-102not101',
      'PL 119-138',
      'PL 119-142',
    ]);
  });

  it('USCT-006: rejects tag overwrite on conflicting content, allows idempotent rerun of identical content, and creates -rev2 superseding tag when correction is authorized', async () => {
    const rp: ReleasePointId = { congress: 119, law: 73, lawSegment: '73', label: 'PL 119-73' };
    const state = await loadState(repoDir);

    // 1. Initial publication of pl-119-73
    await writeFile(join(repoDir, 'statute.md'), 'Version 1 text\n', 'utf-8');
    const commit1 = await gitCommit(repoDir, 'chore(law): Update to PL 119-73');
    const pub1 = await publishImmutableReleaseTag(repoDir, rp, {
      state,
      manifestHash: 'a'.repeat(64),
    });
    expect(pub1).toEqual({
      kind: 'created',
      tagName: 'pl-119-73',
      commitSha: commit1,
      revision: 1,
    });

    // 2. Idempotent rerun of identical content -> noop_identical
    const pubIdentical = await publishImmutableReleaseTag(repoDir, rp, {
      state,
      manifestHash: 'a'.repeat(64),
    });
    expect(pubIdentical.kind).toBe('noop_identical');
    expect(await gitRevParse(repoDir, 'pl-119-73')).toBe(commit1);

    // 3. Conflicting content with allowCorrectionRevision: false -> explicit collision_error, tag NOT moved
    await writeFile(join(repoDir, 'statute.md'), 'Modified corrected text\n', 'utf-8');
    const commit2 = await gitCommit(repoDir, 'chore(law): Corrected PL 119-73');
    const pubCollision = await publishImmutableReleaseTag(repoDir, rp, {
      state,
      manifestHash: 'b'.repeat(64),
      allowCorrectionRevision: false,
    });
    expect(pubCollision.kind).toBe('collision_error');
    // Original tag MUST still point to commit1!
    expect(await gitRevParse(repoDir, 'pl-119-73')).toBe(commit1);

    // 4. Conflicting content with allowCorrectionRevision: true -> creates pl-119-73-rev2 & records supersession
    const pubCorrection = await publishImmutableReleaseTag(repoDir, rp, {
      state,
      manifestHash: 'b'.repeat(64),
      allowCorrectionRevision: true,
      correctionReason: 'OLRC re-issued archive with missing note restored',
    });
    expect(pubCorrection).toEqual({
      kind: 'superseded_revision',
      tagName: 'pl-119-73-rev2',
      commitSha: commit2,
      revision: 2,
      supersedesTag: 'pl-119-73',
      originalCommitSha: commit1,
    });

    // Both original pl-119-73 and pl-119-73-rev2 remain independently resolvable
    expect(await gitRevParse(repoDir, 'pl-119-73')).toBe(commit1);
    expect(await gitRevParse(repoDir, 'pl-119-73-rev2')).toBe(commit2);
    expect(state.supersessions).toHaveLength(1);
    expect(state.supersessions?.[0]?.originalTag).toBe('pl-119-73');
    expect(state.supersessions?.[0]?.revisionTag).toBe('pl-119-73-rev2');
  }, 15_000);
});

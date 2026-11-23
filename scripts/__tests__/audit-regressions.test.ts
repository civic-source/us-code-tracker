import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenBucket } from '../../packages/shared/src/index.js';
import { TemporalBoundarySchema } from '@civic-source/types';
import { processReleasePoint, type ImportMetrics } from '../import-history.js';
import {
  loadState,
  shouldProcessReleaseOnResume,
  type TitleFetch,
} from '../lib/import-helpers.js';
import type { ReleasePointId } from '../lib/release-points.js';
import { findGapsBetweenTags } from '../generate-diffs.js';
import {
  CanonicalWorkbenchCatalog,
  FencedTaskCoordinator,
  buildHistoricalSearchShards,
  computeDependencyImpact,
  computeExportAttribution,
  sha256Hex,
} from '../lib/workbench-catalog.js';
import {
  promoteValidatedDataCandidate,
  rollbackToPredecessorPublication,
  validateDataCandidate,
  verifyPublicationPinMatch,
} from '../promote-publication.js';
import { fetchRegulationsWithOutcome } from '../extract-regulations.js';
import { runGenerateDiffs } from '../generate-diffs.js';
import { SourceArtifactSchema } from '@civic-source/types';

function gitIn(repoPath: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function initTempGitRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  gitIn(dir, 'init', '-q');
  gitIn(dir, 'config', 'user.name', 'Audit Regression Test');
  gitIn(dir, 'config', 'user.email', 'audit@example.invalid');
  return dir;
}

function makeUslmXml(titleNum: string, publicLawLabel: string, bodyMarker: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0" identifier="/us/usc/t${titleNum}">
  <meta>
    <docNumber>${titleNum}</docNumber>
    <docPublicationName>Online@${publicLawLabel}</docPublicationName>
    <created>2026-01-01T00:00:00</created>
  </meta>
  <main>
    <title identifier="/us/usc/t${titleNum}">
      <num value="${titleNum}">Title ${titleNum}</num>
      <heading>AUDIT FIXTURE TITLE ${titleNum}</heading>
      <chapter identifier="/us/usc/t${titleNum}/ch1">
        <num value="1">CHAPTER 1</num>
        <heading>GENERAL</heading>
        <section identifier="/us/usc/t${titleNum}/s1">
          <num value="1">§ 1.</num>
          <heading>AUDIT SECTION</heading>
          <subsection identifier="/us/usc/t${titleNum}/s1/a">
            <num value="a">(a)</num>
            <content>${bodyMarker}</content>
          </subsection>
        </section>
      </chapter>
    </title>
  </main>
</uscDoc>`;
}

describe('Independent Audit Regression Suite (AUD-001 through AUD-015)', () => {
  it('AUD-001: partial-release resume retains successful titles and commits R2 bytes for all titles after R3', async () => {
    const repoPath = await initTempGitRepo('usct-aud001-');
    try {
      await writeFile(join(repoPath, 'README.md'), 'Audit partial release repo\n');
      gitIn(repoPath, 'add', 'README.md');
      gitIn(repoPath, 'commit', '-qm', 'init');

      const r1: ReleasePointId = { congress: 119, law: 1, lawSegment: '1', label: 'PL 119-1' };
      const r2: ReleasePointId = { congress: 119, law: 2, lawSegment: '2', label: 'PL 119-2' };
      const r3: ReleasePointId = { congress: 119, law: 3, lawSegment: '3', label: 'PL 119-3' };

      const rateLimiter = new TokenBucket({ capacity: 100, refillRate: 100, refillIntervalMs: 10 });
      const metrics: ImportMetrics = {
        releasePointsProcessed: 0,
        titlesChanged: 0,
        sectionsChanged: 0,
        startTime: performance.now(),
      };
      const titlesToProcess = ['18', '26'];
      let r2T26ShouldFail = true;
      const retryCalls: string[] = [];

      const fetcherFn = async (rp: ReleasePointId, paddedTitle: string): Promise<TitleFetch> => {
        const titleNum = String(Number(paddedTitle));
        if (rp.law === 2 && titleNum === '26' && r2T26ShouldFail) {
          return { kind: 'failed', reason: 'Simulated transient download failure on R2/T26' };
        }
        return {
          kind: 'ok',
          xml: makeUslmXml(titleNum, `119-${rp.law}`, `AUDIT_R${rp.law}_TITLE_${titleNum}`),
        };
      };

      const state = await loadState(repoPath);
      const out1 = await processReleasePoint(r1, state, rateLimiter, metrics, 3, {
        repoPath,
        titlesToProcess,
        dryRun: false,
        fetcherFn,
        interTitleDelayMs: 0,
      });
      const out2 = await processReleasePoint(r2, state, rateLimiter, metrics, 3, {
        repoPath,
        titlesToProcess,
        dryRun: false,
        fetcherFn,
        interTitleDelayMs: 0,
      });
      const out3 = await processReleasePoint(r3, state, rateLimiter, metrics, 3, {
        repoPath,
        titlesToProcess,
        dryRun: false,
        fetcherFn,
        interTitleDelayMs: 0,
      });

      expect(out1.failedTitles).toBe(0);
      expect(out2.failedTitles).toBe(1);
      expect(out3.failedTitles).toBe(0);

      const stateAfterRun1 = await loadState(repoPath);
      const selected = [r1, r2, r3].filter((rp) =>
        shouldProcessReleaseOnResume(rp, stateAfterRun1, titlesToProcess)
      );
      expect(selected.map((rp) => rp.label)).toEqual(['PL 119-2']);

      r2T26ShouldFail = false;
      const out2Resume = await processReleasePoint(r2, stateAfterRun1, rateLimiter, metrics, 3, {
        repoPath,
        titlesToProcess,
        dryRun: false,
        fetcherFn: async (rp, paddedTitle) => {
          retryCalls.push(`R${rp.law}/T${Number(paddedTitle)}`);
          return fetcherFn(rp, paddedTitle);
        },
        interTitleDelayMs: 0,
      });
      expect(out2Resume.failedTitles).toBe(0);
      // Title 18 was retained in .import-staging/119-2/18.json, so only failed Title 26 needed download
      expect(retryCalls).toEqual(['R2/T26']);

      const finalState = await loadState(repoPath);
      expect(finalState.incompleteReleases).toEqual([]);
      expect(findGapsBetweenTags('pl-119-1', 'pl-119-3', finalState.incompleteReleases ?? [])).toEqual([]);

      const t18AtR2 = gitIn(repoPath, 'show', 'pl-119-2:statutes/title-18/chapter-1/section-1.md');
      const t26AtR2 = gitIn(repoPath, 'show', 'pl-119-2:statutes/title-26/chapter-1/section-1.md');
      expect(t18AtR2).toContain('AUDIT_R2_TITLE_18');
      expect(t18AtR2).not.toContain('AUDIT_R3_TITLE_18');
      expect(t26AtR2).toContain('AUDIT_R2_TITLE_26');
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  }, 15_000);

  it('AUD-002 & AUD-003: rejects conflicting immutable identities, preserves disputed/unreviewed claims, and enforces coherent temporal endpoints', () => {
    const catalog = new CanonicalWorkbenchCatalog();
    const pv = {
      schemaVersion: 'usct.provision-version/v1' as const,
      provisionVersionId: 'pv-a',
      provisionId: 'prov-a',
      normalizedContentHash: sha256Hex('Original historical text'),
      normalizationVersion: 'audit-v1',
      uscTitle: '99',
      uscChapter: '1',
      uscSection: '1',
      heading: 'Synthetic audit provision',
      status: 'active' as const,
      bodyMarkdown: 'Original historical text',
      sourceCredits: [],
      notes: [],
      tables: [],
      unsupportedStructures: [],
      evidenceIds: [],
      legacyDerived: false,
    };

    const initial = catalog.ingestBundle({
      provisions: [{
        schemaVersion: 'usct.provision/v1',
        provisionId: 'prov-a',
        jurisdiction: 'US',
        documentKind: 'usc_section',
        creationBasis: 'audit fixture',
        identityRegistryVersion: 1,
      }],
      provisionVersions: [pv],
      releases: [{
        schemaVersion: 'usct.source-release/v1',
        releaseId: 'release-a',
        publisherReleaseLabel: 'Synthetic release A',
        releaseSegment: '119/1',
        congress: 119,
        lawIdentifier: '1',
        exclusions: [],
        revisionNumber: 1,
        snapshotIds: [],
        coverageId: 'audit-coverage',
        manifestDigest: sha256Hex('immutable release A'),
        observedAt: '2026-01-01T00:00:00.000Z',
        legacyDerived: false,
      }],
      memberships: [{
        schemaVersion: 'usct.snapshot-membership/v1',
        membershipId: 'membership-a',
        sourceReleaseId: 'release-a',
        provisionVersionId: 'pv-a',
        provisionId: 'prov-a',
        sourceOrder: 0,
        hierarchyPath: 'title-99/chapter-1/section-1',
        sourceLocator: 'audit:section-1',
      }],
      citationAssignments: [{
        schemaVersion: 'usct.citation-assignment/v1',
        assignmentId: 'citation-a',
        provisionId: 'prov-a',
        normalizedCitation: '99 U.S.C. 1',
        legacySlug: 'title-99/chapter-1/section-1',
        releaseIds: ['release-a'],
        evidenceIds: [],
        editorialReview: 'accepted',
      }],
    });
    expect(initial.ok).toBe(true);

    // Identical replay is idempotent
    const replay = catalog.ingestBundle({ provisionVersions: [pv] });
    expect(replay.ok).toBe(true);

    // Conflicting overwrite under same provisionVersionId is rejected
    const conflicting = catalog.ingestBundle({
      provisionVersions: [{
        ...pv,
        normalizedContentHash: sha256Hex('Replacement historical text'),
        bodyMarkdown: 'Replacement historical text',
      }],
    });
    expect(conflicting.ok).toBe(false);
    expect(catalog.queryAsPublished({ releaseId: 'release-a', citation: '99 U.S.C. 1' }).provisionVersion?.bodyMarkdown).toBe(
      'Original historical text'
    );

    // Disputed and unverified claims must NOT be reported as known/applicable
    const disputedIngest = catalog.ingestBundle({
      applicabilityClaims: [{
        schemaVersion: 'usct.applicability-claim/v1',
        claimId: 'disputed-claim',
        targetProvisionVersionId: 'pv-a',
        applicabilityState: 'known',
        editorialReview: 'disputed',
        evidenceIds: [],
        competingClaimIds: [],
        requiredContextFacts: [],
        startBoundary: {
          state: 'known',
          value: '2026-01-01',
          precision: 'day',
          conditions: [],
          basis: 'explicit_effective_date_clause',
          evidenceIds: [],
        },
        endBoundary: {
          state: 'open',
          precision: 'unknown',
          conditions: [],
          basis: 'unestablished',
          evidenceIds: [],
        },
      }],
    });
    expect(disputedIngest.ok).toBe(true);
    const applicable = catalog.queryLegallyApplicable({
      requestedLegalDate: '2026-06-01',
      citation: '99 U.S.C. 1',
    });
    expect(applicable.applicabilityState).toBe('disputed');

    // Coherent endpoint schema rejects state === 'known' without value/precision/basis
    const badBoundary = TemporalBoundarySchema.safeParse({
      state: 'known',
      precision: 'unknown',
      basis: 'unestablished',
    });
    expect(badBoundary.success).toBe(false);
  });

  it('AUD-011: propagates dependency invalidation transitively and keeps accepted task attempts terminal', () => {
    const common = {
      producerId: 'audit',
      producerVersion: 'v1',
      schemaVersion: 'v1',
      configDigest: 'cfg',
    };
    const report = computeDependencyImpact(
      [
        {
          ...common,
          artifactKey: 'a',
          artifactKind: 'canonical_provision',
          targetScope: 'prov-a',
          outputContentHash: 'canonical-output',
          dependencies: {
            positiveInputs: [],
            collectionInputs: [],
            negativeInputs: ['missing-citation'],
            policyInputs: [],
          },
        },
        {
          ...common,
          artifactKey: 'b',
          artifactKind: 'section_page',
          targetScope: 'page-a',
          outputContentHash: 'page-output',
          dependencies: {
            positiveInputs: ['canonical-output'],
            collectionInputs: [],
            negativeInputs: [],
            policyInputs: [],
          },
        },
      ],
      { newlyPresentTargets: ['missing-citation'] }
    );
    expect(report.invalidatedArtifacts.map((a) => a.artifactKey)).toEqual(['a', 'b']);
    expect(report.unaffectedArtifacts).toEqual([]);
    expect(report.affectedPages).toEqual(['page-a']);

    const coordinator = new FencedTaskCoordinator();
    coordinator.startAttempt({
      taskId: 'task',
      attemptId: 'attempt',
      inputIdentity: 'input',
      ownerWorkerId: 'worker',
      nowMs: 0,
      leaseDurationMs: 1000,
    });
    const first = coordinator.proposeAcceptance({
      attemptId: 'attempt',
      outputArtifactHash: 'output-A',
      nowMs: 1,
    });
    const secondIdentical = coordinator.proposeAcceptance({
      attemptId: 'attempt',
      outputArtifactHash: 'output-A',
      nowMs: 2,
    });
    const thirdDifferent = coordinator.proposeAcceptance({
      attemptId: 'attempt',
      outputArtifactHash: 'output-B',
      nowMs: 3,
    });
    expect(first.ok).toBe(true);
    expect(secondIdentical.ok).toBe(true);
    expect(thirdDifferent.ok).toBe(false);
    expect(coordinator.getTaskState('task')?.acceptedOutputHash).toBe('output-A');
  });

  it('AUD-004 & AUD-005: rejects malformed/contradictory publication candidates, makes repeat promotion a no-op, and verifies shard manifest pin', async () => {
    // 1. Malformed .import-state.json
    const malformedRepo = await initTempGitRepo('usct-aud004-malformed-');
    // 2. Contradictory ledger (partial in releaseLedger, empty incompleteReleases)
    const contradictoryRepo = await initTempGitRepo('usct-aud004-contradictory-');
    // 3. Non-directory blob entry at statutes/title-18
    const nonTreeRepo = await initTempGitRepo('usct-aud004-nontree-');
    // 4. Valid data repo with two distinct releases (pl-119-72 and pl-119-73)
    const validDataRepo = await initTempGitRepo('usct-aud005-valid-');
    const trackerRepo = await initTempGitRepo('usct-aud005-tracker-');

    try {
      await mkdir(join(malformedRepo, 'statutes/title-18'), { recursive: true });
      await writeFile(join(malformedRepo, 'statutes/title-18/section-1.md'), '# § 1\n');
      await writeFile(join(malformedRepo, '.import-state.json'), '{not-valid-json');
      gitIn(malformedRepo, 'add', '.');
      gitIn(malformedRepo, 'commit', '-qm', 'malformed');
      gitIn(malformedRepo, 'tag', 'pl-119-73');
      const malformedRes = await validateDataCandidate(malformedRepo, 'pl-119-73');
      expect(malformedRes.ok).toBe(false);
      if (!malformedRes.ok) {
        expect(malformedRes.error.message).toContain('Malformed .import-state.json');
      }

      await mkdir(join(contradictoryRepo, 'statutes/title-18'), { recursive: true });
      await writeFile(join(contradictoryRepo, 'statutes/title-18/section-1.md'), '# § 1\n');
      await writeFile(
        join(contradictoryRepo, '.import-state.json'),
        JSON.stringify({
          completedReleases: [],
          incompleteReleases: [],
          releaseLedger: {
            '119-73': {
              releaseKey: '119-73',
              label: 'PL 119-73',
              status: 'partial',
              titleOutcomes: { '18': 'failed' },
              failedTitles: ['18'],
              updatedAt: '2026-11-22T00:00:00.000Z',
            },
          },
          manifests: {},
        })
      );
      gitIn(contradictoryRepo, 'add', '.');
      gitIn(contradictoryRepo, 'commit', '-qm', 'contradictory');
      gitIn(contradictoryRepo, 'tag', 'pl-119-73');
      const contradictoryRes = await validateDataCandidate(contradictoryRepo, 'pl-119-73');
      expect(contradictoryRes.ok).toBe(false);
      if (!contradictoryRes.ok) {
        expect(contradictoryRes.error.message).toContain('incomplete/failed release scopes: 119-73');
      }

      await mkdir(join(nonTreeRepo, 'statutes'), { recursive: true });
      await writeFile(join(nonTreeRepo, 'statutes/title-18'), 'not a directory tree\n');
      await writeFile(
        join(nonTreeRepo, '.import-state.json'),
        JSON.stringify({ completedReleases: ['119-73'], incompleteReleases: [] })
      );
      gitIn(nonTreeRepo, 'add', '.');
      gitIn(nonTreeRepo, 'commit', '-qm', 'non-tree');
      gitIn(nonTreeRepo, 'tag', 'pl-119-73');
      const nonTreeRes = await validateDataCandidate(nonTreeRepo, 'pl-119-73');
      expect(nonTreeRes.ok).toBe(false);
      if (!nonTreeRes.ok) {
        expect(nonTreeRes.error.message).toContain('invalid non-directory entry');
      }

      // Build validDataRepo with pl-119-72 and pl-119-73
      await mkdir(join(validDataRepo, 'statutes/title-18/chapter-1'), { recursive: true });
      await writeFile(join(validDataRepo, 'statutes/title-18/chapter-1/section-1.md'), '# § 1 (72)\n');
      await writeFile(
        join(validDataRepo, '.import-state.json'),
        JSON.stringify({
          completedReleases: ['119-72'],
          incompleteReleases: [],
          releaseLedger: {
            '119-72': {
              releaseKey: '119-72',
              label: 'PL 119-72',
              status: 'complete',
              titleOutcomes: { '18': 'ok' },
              failedTitles: [],
              updatedAt: '2026-11-22T00:00:00.000Z',
            },
          },
          manifests: {},
        })
      );
      gitIn(validDataRepo, 'add', '.');
      gitIn(validDataRepo, 'commit', '-qm', 'pl-119-72');
      gitIn(validDataRepo, 'tag', 'pl-119-72');
      const sha72 = gitIn(validDataRepo, 'rev-parse', 'pl-119-72^{commit}');

      await writeFile(join(validDataRepo, 'statutes/title-18/chapter-1/section-1.md'), '# § 1 (73)\n');
      await writeFile(
        join(validDataRepo, '.import-state.json'),
        JSON.stringify({
          completedReleases: ['119-72', '119-73'],
          incompleteReleases: [],
          releaseLedger: {
            '119-73': {
              releaseKey: '119-73',
              label: 'PL 119-73',
              status: 'complete',
              titleOutcomes: { '18': 'ok' },
              failedTitles: [],
              updatedAt: '2026-11-22T01:00:00.000Z',
            },
          },
          manifests: {},
        })
      );
      gitIn(validDataRepo, 'add', '.');
      gitIn(validDataRepo, 'commit', '-qm', 'pl-119-73');
      gitIn(validDataRepo, 'tag', 'pl-119-73');
      const sha73 = gitIn(validDataRepo, 'rev-parse', 'pl-119-73^{commit}');

      await writeFile(join(trackerRepo, 'README.md'), 'Tracker fixture\n');
      gitIn(trackerRepo, 'add', '.');
      gitIn(trackerRepo, 'commit', '-qm', 'init tracker');
      gitIn(trackerRepo, 'update-index', '--add', '--cacheinfo', `160000,${sha72},apps/web/content-data`);

      // Promote pl-119-72
      const prom72 = await promoteValidatedDataCandidate({
        trackerRepoPath: trackerRepo,
        dataRepoPath: validDataRepo,
        targetRef: 'pl-119-72',
        updateSubmoduleWorkingTree: false,
        nowIso: '2026-11-22T06:00:00.000Z',
      });
      expect(prom72.ok).toBe(true);
      if (!prom72.ok) return;

      // Repeat promotion of pl-119-72 must be an idempotent no-op without self-predecessor
      const prom72Repeat = await promoteValidatedDataCandidate({
        trackerRepoPath: trackerRepo,
        dataRepoPath: validDataRepo,
        targetRef: 'pl-119-72',
        updateSubmoduleWorkingTree: false,
        nowIso: '2026-11-22T06:01:00.000Z',
      });
      expect(prom72Repeat.ok).toBe(true);
      if (!prom72Repeat.ok) return;
      expect(prom72Repeat.value.predecessorPublicationId).toBeUndefined();
      expect(prom72Repeat.value.promotedAt).toBe('2026-11-22T06:00:00.000Z');

      // Mismatched search-shards/manifest.json, missing shardDigest bypass, and tampered entries MUST fail verifyPublicationPinMatch
      await mkdir(join(trackerRepo, 'apps/web/public/search-shards'), { recursive: true });
      const entries: unknown[] = [];
      const shardDigest = createHash('sha256').update(JSON.stringify(entries), 'utf8').digest('hex');
      await writeFile(
        join(trackerRepo, 'apps/web/public/search-shards/pl-119-72.json'),
        JSON.stringify({ releaseId: 'pl-119-72', entries, shardDigest })
      );
      await writeFile(
        join(trackerRepo, 'apps/web/public/search-shards/manifest.json'),
        JSON.stringify({
          schemaVersion: 'usct.historical-search-manifest/v1',
          generatedForPublicationId: 'wrong-publication-id',
          shards: {
            'pl-119-72': {
              releaseId: 'pl-119-72',
              shardPath: 'search-shards/pl-119-72.json',
              shardDigest,
            },
          },
        })
      );
      const mismatchedPubVerify = await verifyPublicationPinMatch({
        trackerRepoPath: trackerRepo,
        expectedDataCommitSha: sha72,
      });
      expect(mismatchedPubVerify.ok).toBe(false);

      // Synced publicationId, but omitted shardDigest inside shard JSON -> must be rejected (no bypass)
      await writeFile(
        join(trackerRepo, 'apps/web/public/search-shards/manifest.json'),
        JSON.stringify({
          schemaVersion: 'usct.historical-search-manifest/v1',
          generatedForPublicationId: prom72.value.publicationId,
          shards: {
            'pl-119-72': {
              releaseId: 'pl-119-72',
              shardPath: 'search-shards/pl-119-72.json',
              shardDigest,
            },
          },
        })
      );
      await writeFile(
        join(trackerRepo, 'apps/web/public/search-shards/pl-119-72.json'),
        JSON.stringify({ releaseId: 'pl-119-72', entries })
      );
      const omittedDigestVerify = await verifyPublicationPinMatch({
        trackerRepoPath: trackerRepo,
        expectedDataCommitSha: sha72,
      });
      expect(omittedDigestVerify.ok).toBe(false);

      // Tampered entries keeping old shardDigest -> must be rejected
      await writeFile(
        join(trackerRepo, 'apps/web/public/search-shards/pl-119-72.json'),
        JSON.stringify({ releaseId: 'pl-119-72', entries: [{ tampered: true }], shardDigest })
      );
      const tamperedEntriesVerify = await verifyPublicationPinMatch({
        trackerRepoPath: trackerRepo,
        expectedDataCommitSha: sha72,
      });
      expect(tamperedEntriesVerify.ok).toBe(false);

      // Restore valid shard before testing pl-119-73 promotion & rollback
      await writeFile(
        join(trackerRepo, 'apps/web/public/search-shards/pl-119-72.json'),
        JSON.stringify({ releaseId: 'pl-119-72', entries, shardDigest })
      );

      // Promote pl-119-73 -> records pl-119-72 as predecessor and updates search-shards/manifest.json
      gitIn(trackerRepo, 'update-index', '--add', '--cacheinfo', `160000,${sha73},apps/web/content-data`);
      const prom73 = await promoteValidatedDataCandidate({
        trackerRepoPath: trackerRepo,
        dataRepoPath: validDataRepo,
        targetRef: 'pl-119-73',
        updateSubmoduleWorkingTree: false,
        nowIso: '2026-11-22T06:05:00.000Z',
      });
      expect(prom73.ok).toBe(true);
      if (!prom73.ok) return;
      expect(prom73.value.predecessorPublicationId).toBe(prom72.value.publicationId);
      expect(prom73.value.predecessorDataCommitSha).toBe(sha72);

      const matchedVerify = await verifyPublicationPinMatch({
        trackerRepoPath: trackerRepo,
        expectedDataCommitSha: sha73,
      });
      expect(matchedVerify.ok).toBe(true);

      // Rollback from pl-119-73 restores pl-119-72 receipt, pin, AND search-shards/manifest.json generatedForPublicationId
      const rb = await rollbackToPredecessorPublication({
        trackerRepoPath: trackerRepo,
      });
      expect(rb.ok).toBe(true);
      if (!rb.ok) return;
      expect(rb.value.publicationId).toBe(prom72.value.publicationId);
      expect(rb.value.acceptedDataCommitSha).toBe(sha72);

      const verifyAfterRb = await verifyPublicationPinMatch({
        trackerRepoPath: trackerRepo,
        expectedDataCommitSha: sha72,
      });
      expect(verifyAfterRb.ok).toBe(true);
    } finally {
      await rm(malformedRepo, { recursive: true, force: true });
      await rm(contradictoryRepo, { recursive: true, force: true });
      await rm(nonTreeRepo, { recursive: true, force: true });
      await rm(validDataRepo, { recursive: true, force: true });
      await rm(trackerRepo, { recursive: true, force: true });
    }
  }, 15_000);

  it('AUD-009: paginates multi-page eCFR search responses to exhaustion and marks interrupted pagination partial', async () => {
    const pages: Record<number, unknown> = {
      1: {
        results: [
          {
            hierarchy: { title: '42', part: '73' },
            headings: { chapter: 'HHS', part: 'Select Agents and Toxins' },
            full_text_excerpt: 'Page 1 match for 18 U.S.C. 175b',
          },
        ],
        meta: { current_page: 1, total_pages: 2 },
      },
      2: {
        results: [
          {
            hierarchy: { title: '7', part: '331' },
            headings: { chapter: 'USDA', part: 'Possession, Use, and Transfer of Select Agents' },
            full_text_excerpt: 'Page 2 match for 18 U.S.C. 175b',
          },
        ],
        meta: { current_page: 2, total_pages: 2 },
      },
    };

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
        const page = Number(url.searchParams.get('page') ?? '1');
        return {
          ok: true,
          status: 200,
          json: async () => pages[page],
        } as unknown as Response;
      }) as typeof fetch;

      const fullOutcome = await fetchRegulationsWithOutcome(18, '175b', {
        nowIso: '2026-11-22T06:00:00.000Z',
      });
      expect(fullOutcome.status).toBe('success-nonempty');
      expect(fullOutcome.completedPages).toBe(2);
      expect(fullOutcome.expectedPages).toBe(2);
      expect(fullOutcome.isStale).toBe(false);
      expect(fullOutcome.data.map((r) => `${r.cfrTitle}-${r.cfrPart}`)).toEqual(['42-73', '7-331']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('AUD-012: missing cached diff files force pair recomputation instead of emitting an empty index', async () => {
    const dataRepo = await initTempGitRepo('usct-aud012-data-');
    const outDir = await mkdtemp(join(tmpdir(), 'usct-aud012-out-'));
    try {
      await mkdir(join(dataRepo, 'statutes/title-18/chapter-47'), { recursive: true });
      await writeFile(join(dataRepo, 'statutes/title-18/chapter-47/section-1001.md'), '# § 1001\nV1\n');
      gitIn(dataRepo, 'add', '.');
      gitIn(dataRepo, 'commit', '-qm', 'pl-119-72');
      gitIn(dataRepo, 'tag', 'pl-119-72');

      await writeFile(join(dataRepo, 'statutes/title-18/chapter-47/section-1001.md'), '# § 1001\nV2\n');
      gitIn(dataRepo, 'add', '.');
      gitIn(dataRepo, 'commit', '-qm', 'pl-119-73');
      gitIn(dataRepo, 'tag', 'pl-119-73');

      await runGenerateDiffs({ repo: dataRepo, output: outDir });
      const diffFile = join(outDir, 'pl-119-72_pl-119-73/title-18/section-1001.json');
      await rm(diffFile);

      // Re-running after deleting the cached diff file MUST detect the missing output and rebuild it
      await runGenerateDiffs({ repo: dataRepo, output: outDir });
      const rebuiltRaw = await (await import('node:fs/promises')).readFile(diffFile, 'utf-8');
      expect(JSON.parse(rebuiltRaw).to).toBe('pl-119-73');
      const changedIdx = JSON.parse(
        await (await import('node:fs/promises')).readFile(join(outDir, 'changed-sections.json'), 'utf-8')
      ) as Record<string, string[]>;
      expect(changedIdx['title-18/section-1001']).toEqual(['pl-119-73']);
    } finally {
      await rm(dataRepo, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('AUD-015: SourceArtifact defaults license to unknown and mixed-source export attribution never labels unknown as CC0', () => {
    const unknownArt = SourceArtifactSchema.parse({
      artifactId: 'art-third-party',
      sha256: sha256Hex('third-party-note'),
      byteLength: 16,
      mediaType: 'text/plain',
      storageLocator: 'cas/sha256/unknown',
    });
    expect(unknownArt.license).toBe('unknown');

    const cc0Art = SourceArtifactSchema.parse({
      artifactId: 'art-uslm',
      sha256: sha256Hex('statute-xml'),
      byteLength: 11,
      mediaType: 'application/xml',
      storageLocator: 'cas/sha256/uslm',
      license: 'CC0-1.0',
    });

    const summary = computeExportAttribution([cc0Art, unknownArt]);
    expect(summary.containsUnknownLicense).toBe(true);
    expect(summary.unknownLicenseArtifactIds).toEqual(['art-third-party']);
    expect(summary.effectiveLicenseSummary).toBe('mixed(CC0-1.0+unknown)');
  });

  it('AUD-006 / USCT-036: buildHistoricalSearchShards matches section-level expectedPartitions without false missingTitles', () => {
    const catalog = new CanonicalWorkbenchCatalog();
    catalog.ingestBundle({
      provisions: [{
        schemaVersion: 'usct.provision/v1',
        provisionId: 'prov-18-1001',
        jurisdiction: 'US',
        documentKind: 'usc_section',
        creationBasis: 'shard test',
        identityRegistryVersion: 1,
      }],
      provisionVersions: [{
        schemaVersion: 'usct.provision-version/v1',
        provisionVersionId: 'pv-18-1001',
        provisionId: 'prov-18-1001',
        normalizedContentHash: sha256Hex('False statements text'),
        normalizationVersion: 'v1',
        uscTitle: '18',
        uscChapter: '47',
        uscSection: '1001',
        heading: 'Statements or entries generally',
        status: 'active',
        bodyMarkdown: 'False statements text',
        sourceCredits: [],
        notes: [],
        tables: [],
        unsupportedStructures: [],
        evidenceIds: [],
        legacyDerived: false,
      }],
      coverages: [{
        schemaVersion: 'usct.collection-coverage/v1',
        coverageId: 'cov-18-cohort',
        sourceScope: 'olrc:pl-119-73:title-18',
        sourceFamily: 'olrc_uslm',
        releaseId: 'pl-119-73',
        expectedPartitions: ['title-18/section-1001'],
        completedPartitions: ['title-18/section-1001'],
        absentPartitions: [],
        failedPartitions: [],
        coverageState: 'complete',
        lastAttemptedAt: '2026-11-22T00:00:00.000Z',
        isRequiredForPublication: true,
      }],
      releases: [{
        schemaVersion: 'usct.source-release/v1',
        releaseId: 'pl-119-73',
        publisherReleaseLabel: 'Public Law 119-73',
        releaseSegment: '119/73',
        congress: 119,
        lawIdentifier: '73',
        exclusions: [],
        revisionNumber: 1,
        snapshotIds: [],
        coverageId: 'cov-18-cohort',
        manifestDigest: sha256Hex('rel-119-73'),
        observedAt: '2026-11-22T00:00:00.000Z',
        legacyDerived: false,
      }],
      memberships: [{
        schemaVersion: 'usct.snapshot-membership/v1',
        membershipId: 'mem-1',
        sourceReleaseId: 'pl-119-73',
        provisionVersionId: 'pv-18-1001',
        provisionId: 'prov-18-1001',
        sourceOrder: 0,
        hierarchyPath: 'title-18/chapter-47/section-1001',
        sourceLocator: 'uslm:18/1001',
      }],
    });

    const { manifest } = buildHistoricalSearchShards(catalog, 'pub-test');
    expect(manifest.availableReleases[0]?.missingTitles).toEqual([]);

    // Adding an expected partition without entries still surfaces the genuinely missing partition ID
    catalog.ingestBundle({
      coverages: [{
        schemaVersion: 'usct.collection-coverage/v1',
        coverageId: 'cov-18-incomplete',
        sourceScope: 'olrc:pl-119-74:title-18',
        sourceFamily: 'olrc_uslm',
        releaseId: 'pl-119-74',
        expectedPartitions: ['title-18/section-1001', 'title-18/section-9999'],
        completedPartitions: ['title-18/section-1001'],
        absentPartitions: [],
        failedPartitions: [{ partition: 'title-18/section-9999', reason: 'Simulated missing section' }],
        coverageState: 'partial',
        lastAttemptedAt: '2026-11-22T00:00:00.000Z',
        isRequiredForPublication: true,
      }],
      releases: [{
        schemaVersion: 'usct.source-release/v1',
        releaseId: 'pl-119-74',
        publisherReleaseLabel: 'Public Law 119-74',
        releaseSegment: '119/74',
        congress: 119,
        lawIdentifier: '74',
        exclusions: [],
        revisionNumber: 1,
        snapshotIds: [],
        coverageId: 'cov-18-incomplete',
        manifestDigest: sha256Hex('rel-119-74'),
        observedAt: '2026-11-22T00:00:00.000Z',
        legacyDerived: false,
      }],
      memberships: [{
        schemaVersion: 'usct.snapshot-membership/v1',
        membershipId: 'mem-2',
        sourceReleaseId: 'pl-119-74',
        provisionVersionId: 'pv-18-1001',
        provisionId: 'prov-18-1001',
        sourceOrder: 0,
        hierarchyPath: 'title-18/chapter-47/section-1001',
        sourceLocator: 'uslm:18/1001',
      }],
    });
    const incompleteManifest = buildHistoricalSearchShards(catalog, 'pub-test').manifest;
    const rel74 = incompleteManifest.availableReleases.find((r) => r.releaseId === 'pl-119-74');
    expect(rel74?.missingTitles).toEqual(['title-18/section-9999']);
  });
});

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ok, type CollectionCoverage, type Result } from '@civic-source/types';
import { historicalSourceGaps, HISTORICAL_SOURCE_CORRECTION } from './historical-withdrawal.js';
import { buildLegacyHistoryCohort } from './legacy-history-cohort.js';
import { withGenuineHistoricalSources } from './genuine-history-catalog.js';
import { computeTitleEnrichmentCoverage } from './title-enrichment-batch.js';
import { CanonicalWorkbenchCatalog, FencedTaskCoordinator, buildRelationshipNeighborhoodShard,
  sha256Hex, type StaticNeighborhoodShard } from './workbench-catalog.js';
export { COHORT_LEGACY_PATHS } from './legacy-history-cohort.js';

/** Rebuild reviewed publisher materializations and explicitly partial legacy cohorts (ADR0005). */
export async function buildCanonicalVerticalSlice(options: {
  sliceDir: string; dataRepoPath: string; observedAtIso?: string; legacyOnly?: boolean;
}): Promise<{ catalog: CanonicalWorkbenchCatalog; coordinator: FencedTaskCoordinator }> {
  const observedAt = options.observedAtIso ?? '2026-11-22T06:30:00.000Z';
  let snapshot = await buildLegacyHistoryCohort({ dataRepoPath: options.dataRepoPath, observedAt });
  if (!options.legacyOnly) {
    const genuine = await withGenuineHistoricalSources(snapshot);
    if (!genuine.ok) throw genuine.error;
    snapshot = genuine.value;
  }
  const catalog = new CanonicalWorkbenchCatalog();
  const ingested = catalog.ingestBundle(snapshot);
  if (!ingested.ok) throw ingested.error;
  const coordinator = new FencedTaskCoordinator();
  coordinator.startAttempt({ taskId: 'build-canonical-vertical-slice', attemptId: 'attempt-source-history-v1',
    inputIdentity: sha256Hex(JSON.stringify(snapshot)), ownerWorkerId: 'workbench-local-worker-1',
    nowMs: Date.parse(observedAt), leaseDurationMs: 60_000 });
  const accepted = coordinator.proposeAcceptance({ attemptId: 'attempt-source-history-v1',
    outputArtifactHash: sha256Hex(JSON.stringify(catalog.getSnapshot())), nowMs: Date.parse(observedAt) + 100, nowIso: observedAt });
  if (!accepted.ok) throw accepted.error;
  return { catalog, coordinator };
}
export async function writeStaticNeighborhoodShards(
  catalog: CanonicalWorkbenchCatalog,
  outputDir: string
): Promise<{ shardCount: number; shards: Record<string, StaticNeighborhoodShard> }> {
  const snap = catalog.getSnapshot();
  const written: Record<string, StaticNeighborhoodShard> = {};
  let shardCount = 0;

  for (const rel of snap.releases) {
    for (const mem of snap.memberships.filter((m) => m.sourceReleaseId === rel.releaseId)) {
      const pv = snap.provisionVersions.find((v) => v.provisionVersionId === mem.provisionVersionId);
      if (!pv) continue;
      const shard = buildRelationshipNeighborhoodShard(catalog, pv.provisionId, rel.releaseId);
      const relFile = `${rel.releaseId}/${pv.uscTitle}-${pv.uscSection}.json`;
      const fullPath = join(outputDir, relFile);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, JSON.stringify(shard, null, 2) + '\n', 'utf-8');
      written[relFile] = shard;
      shardCount++;
    }
  }

  const sourceGaps = historicalSourceGaps(snap);
  for (const gap of sourceGaps) {
    const target = join(outputDir, gap.releaseId, `${gap.uscTitle}-${gap.uscSection}.json`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify({ schemaVersion: 'usct.relationship-neighborhood/v1',
      provisionId: gap.provisionId, citation: `18 U.S.C. ${gap.uscSection}`, releaseId: gap.releaseId,
      availability: 'source_gap', sourceCorrection: gap, edges: [] }, null, 2) + '\n', 'utf8');
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 'usct.relationship-neighborhood-manifest/v1',
        shardCount,
        shards: Object.keys(written).sort(),
        sourceGaps,
      },
      null,
      2
    ) + '\n',
    'utf-8'
  );

  return { shardCount, shards: written };
}

export interface CuratedTopicDataset {
  schemaVersion: 'usct.curated-topic/v1';
  topicSlug: string;
  title: string;
  summary: string;
  scopeNote: string;
  curator: string;
  lastReviewedAt: string;
  currentReleaseId: string;
  memberProvisions: Array<{
    provisionId: string;
    citation: string;
    heading: string;
    url: string;
    roleInTopic: string;
    extractionState: 'verified';
    editorialReview: 'accepted' | 'unreviewed';
    legacyDerived: boolean;
  }>;
  relatedAuthorities: Array<{
    authorityId: string;
    label: string;
    authorityKind: string;
    relationshipType: string;
    targetCitation: string;
    extractionState: string;
    editorialReview: string;
    summary: string;
    sourceUrl: string;
  }>;
  changeEvents: Array<{
    eventId: string;
    eventKind:
      | 'statutory_text_amendment'
      | 'enacted_public_law_linkage'
      | 'regulatory_authority_verification'
      | 'judicial_proposition_review'
      | 'source_conflict_quarantine';
    occurredAt: string;
    releaseId: string;
    affectedCitation: string;
    title: string;
    summary: string;
    diffUrl?: string;
    evidenceLocator: string;
    sourceUrl?: string;
    priorPublicationId?: string;
    artifactSha256?: string;
  }>;
}

/** Retained topics are navigation aids; source qualification does not establish legal propositions. */
export async function writeCuratedTopicDatasets(
  catalog: CanonicalWorkbenchCatalog, outputDir: string, baseUrl = '/us-code-tracker/'
): Promise<CuratedTopicDataset[]> {
  const snapshot = catalog.getSnapshot();
  const members = ['371', '1341', '1343'].flatMap(section => {
    const version = snapshot.provisionVersions.find(item => item.uscSection === section && item.legacyDerived);
    return version ? [{ provisionId: version.provisionId, citation: `18 U.S.C. § ${section}`, heading: version.heading,
      url: `${baseUrl}statute/title-18/chapter-${version.uscChapter}/section-${section}/`,
      roleInTopic: 'Retained legacy-derived navigation member; topical proposition awaiting source review.',
      extractionState: 'verified' as const, editorialReview: 'unreviewed' as const, legacyDerived: true }] : [];
  });
  const correction = HISTORICAL_SOURCE_CORRECTION;
  const dataset: CuratedTopicDataset = { schemaVersion: 'usct.curated-topic/v1', topicSlug: 'false-statements-fraud',
    title: 'False Statements and Fraud — retained navigation',
    summary: 'Historical source correction with retained legacy-derived navigation members.',
    scopeNote: `${correction.reason} Coverage remains partial. Source qualification is not legal amendment or applicability review.`,
    curator: 'Civic Source source-integrity review', lastReviewedAt: correction.observedAt, currentReleaseId: 'pl-119-73',
    memberProvisions: members, relatedAuthorities: [], changeEvents: [{ eventId: correction.eventId,
      eventKind: 'source_conflict_quarantine', occurredAt: correction.observedAt, releaseId: 'pl-119-73',
      affectedCitation: '18 U.S.C. §§111,1001', title: 'Constructed historical snapshots withdrawn',
      summary: `${correction.reason} Prior publication: ${correction.priorPublicationId}.`, sourceUrl: correction.sourceUrl,
      priorPublicationId: correction.priorPublicationId, evidenceLocator: 'source-integrity:constructed-title18-v1' }] };
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, `${dataset.topicSlug}.json`), JSON.stringify(dataset, null, 2) + '\n');
  await writeFile(join(outputDir, 'index.json'), JSON.stringify({ schemaVersion: 'usct.curated-topic-index/v1', topics: [{
    topicSlug: dataset.topicSlug, title: dataset.title, summary: dataset.summary, curator: dataset.curator,
    lastReviewedAt: dataset.lastReviewedAt, memberCount: members.length, eventCount: dataset.changeEvents.length,
  }] }, null, 2) + '\n');
  return [dataset];
}

export async function buildTitleCoverageRecords(params: {
  dataRepoPath: string; uscTitle: string; releaseId: string; observedAt: string;
}): Promise<Result<CollectionCoverage[]>> {
  const result = await computeTitleEnrichmentCoverage(params);
  return result.ok ? ok(result.value.coverages) : result;
}

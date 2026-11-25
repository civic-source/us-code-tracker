import { SourceArtifactSchema, SourceSnapshotSchema, SourceReleaseSchema,
  ProvisionSchema, CitationAssignmentSchema, CollectionCoverageSchema,
  err, ok, type Result } from '@civic-source/types';
import type { CatalogStateSnapshot } from './workbench-catalog.js';
import { historicalSourcePins } from './olrc-historical-sources.js';
import { historicalRecipeDigest } from './olrc-history-materialize.js';
import { reviewedHistoricalVersions, historicalCollectionIdentity, historicalMembership } from './historical-qualification.js';

/** Build-time materializations are reviewed products; publisher archives remain outside Pages. */
export async function readReviewedHistoricalVersions() {
  const recipe = await historicalRecipeDigest();
  return reviewedHistoricalVersions().map(parsed => {
    if (parsed.sourceQualification?.recipeSha256 !== recipe) throw new Error('Historical compiler/renderer recipe changed; requalification required');
    return parsed;
  });
}

/** Rebuild a fresh catalog, retaining legacy rows without relabelling them as publisher-qualified. */
export async function withGenuineHistoricalSources(snapshot: CatalogStateSnapshot): Promise<Result<CatalogStateSnapshot>> {
  try {
    const result = structuredClone(snapshot);
    const versions = await readReviewedHistoricalVersions();
    for (const source of historicalSourcePins) {
      const collection = historicalCollectionIdentity(source.releaseId);
      if (result.releases.some(item => item.releaseId === collection.releaseId)) continue;
      const selected = versions.filter((version) => version.sourceQualification?.releaseId === source.releaseId);
      const archiveId = `art-olrc-zip-${source.archive.sha256}`;
      const memberId = `art-olrc-member-${source.member.sha256}`;
      const snapshotId = `snap-olrc-pilot-${source.archive.sha256}`;
      result.artifacts.push(SourceArtifactSchema.parse({ artifactId: archiveId, ...source.archive,
        mediaType: 'application/zip', storageLocator: `sha256:${source.archive.sha256}`, license: 'CC0-1.0' }),
      SourceArtifactSchema.parse({ artifactId: memberId, sha256: source.member.sha256, byteLength: source.member.byteLength,
        mediaType: 'application/xml', storageLocator: `zip:sha256:${source.archive.sha256}!/usc18.xml`,
        parentArchiveArtifactId: archiveId, license: 'CC0-1.0' }));
      result.snapshots.push(SourceSnapshotSchema.parse({ snapshotId, sourceRegistryId: 'olrc-releasepoints',
        requestedUrl: source.requestedUrl, finalUrl: source.finalUrl, publisher: source.publisher,
        authorityKind: 'statute', artifactId: memberId, retrievedAt: source.retrievedAt,
        publisherReleaseLabel: source.publisherEdition }));
      appendVersions(result, selected, collection.releaseId);
      const law = source.releaseId.split('-')[2]!;
      result.releases.push(SourceReleaseSchema.parse({ ...collection, publisherReleaseId: source.releaseId,
        publisherReleaseLabel: `${source.publisherEdition} (source-qualified pilot, 3 of 1399)`,
        releaseSegment: 'Title 18 bounded source-qualified pilot; legacy cohorts are separate collections.',
        congress: 119, lawIdentifier: law, snapshotIds: [snapshotId], coverageId: `cov-${collection.releaseId}`,
        observedAt: source.retrievedAt }));
      result.coverages.push(CollectionCoverageSchema.parse({ coverageId: `cov-${collection.releaseId}`,
        sourceScope: `olrc:${source.releaseId}:title-18:qualified-3-of-${source.canonicalProvisionCount}`,
        sourceFamily: 'olrc_uslm', releaseId: collection.releaseId, titleFilter: '18',
        expectedPartitions: ['title-18'], completedPartitions: [], coverageState: 'partial',
        failedPartitions: [{ partition: 'title-18', reason: `Only 3 of ${source.canonicalProvisionCount} canonical provisions independently qualified; legacy members do not increase this count.` }],
        lastAttemptedAt: source.retrievedAt }));
    }
    return ok(result);
  } catch (error) { return err(error instanceof Error ? error : new Error(String(error))); }
}

function appendVersions(snapshot: CatalogStateSnapshot, versions: Awaited<ReturnType<typeof readReviewedHistoricalVersions>>, releaseId: string) {
  for (const version of versions) {
    if (!snapshot.provisions.some((item) => item.provisionId === version.provisionId)) snapshot.provisions.push(ProvisionSchema.parse({
      provisionId: version.provisionId, documentKind: 'usc_section', creationBasis: 'Pinned OLRC USLM section identifier' }));
    snapshot.provisionVersions.push(version);
    snapshot.memberships.push(historicalMembership(version));
    const prior = snapshot.citationAssignments.find((item) => item.provisionId === version.provisionId);
    if (prior) { if (!prior.releaseIds.includes(releaseId)) prior.releaseIds.push(releaseId); }
    else snapshot.citationAssignments.push(CitationAssignmentSchema.parse({ assignmentId: `ca-olrc-${version.provisionId}`,
      provisionId: version.provisionId, legacySlug: `title-18/chapter-${version.uscChapter}/section-${version.uscSection}`, normalizedCitation: `18 U.S.C. ${version.uscSection}`, releaseIds: [releaseId], editorialReview: 'unreviewed' }));
  }
}

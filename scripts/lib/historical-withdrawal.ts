import { createHash } from 'node:crypto';
import type { CatalogStateSnapshot } from './workbench-catalog.js';
import type { CuratedTopicDataset } from './canonical-vertical-slice.js';

const CONSTRUCTED_VERSIONS = new Set([
  'pv-18-1001-pl-116-220', 'pv-18-1001-pl-119-73',
  'pv-18-111-pl-116-220', 'pv-18-111-pl-119-73',
]);
const CONSTRUCTED_ASSERTIONS = new Set([
  'assert-18-1001-cites-2331', 'assert-18-1001-cites-175b-pl119',
  'assert-plaw-104-292-amends-18-1001', 'assert-cfr-19-162-authority-18-1001',
  'assert-scotus-brogan-interprets-18-1001', 'assert-18-111-cites-1114',
]);
const CONSTRUCTED_TOPIC_EVENTS = new Set([
  'evt-18-1001-pl-119-73-amendment', 'evt-18-1001-ecfr-19-162-verified',
  'evt-18-1001-brogan-verified', 'evt-fr-2026-09112-quarantined',
]);
const CONSTRUCTED_ARTIFACTS = new Set([
  'art-uslm-18-1001-pl-116-220', 'art-uslm-18-1001-pl-119-73',
  'art-uslm-18-111-pl-116-220', 'art-uslm-18-111-pl-119-73',
  'art-plaw-104-292', 'art-ecfr-19-part-162', 'art-cl-brogan-522-us-398',
]);
const CONSTRUCTED_DIGESTS = new Set([
  '8a43932ca5387145c151661e622bf9ac99e965a40852953bdb95aa7c10af9d28',
  '477f966bb808315a1b9251408a41647bf3ae9764baa0a472f03dd12138fbc72e',
  '95313f65e7c43a7ccffd9524822f7756917d745914c315a5a15d8a0d330d2e10',
  'f77982e6e401951bb9144c112891cea2ee28456a0b38bca2b951c63830c23328',
  '59d8a598d6a03201dd3715085d319a70db2b225f68340e707fd3c6c4e382e270',
  'c81018bbdfe246fe5bf80c10e4116e34c43949aacae30d194d3934ebba75eb8b',
  '564efccc178d96164ac92e657379f74185a04df00d89b3e78debeaa5be7f3bdd',
]);

function withdrawnSources(snapshot: CatalogStateSnapshot) {
  const artifacts = snapshot.artifacts.filter((item) =>
    CONSTRUCTED_ARTIFACTS.has(item.artifactId) || CONSTRUCTED_DIGESTS.has(item.sha256));
  const artifactIds = new Set(artifacts.map((item) => item.artifactId));
  const hashes = new Set([...CONSTRUCTED_DIGESTS, ...artifacts.map((item) => item.sha256)]);
  const snapshots = new Set(snapshot.snapshots.filter((item) => artifactIds.has(item.artifactId))
    .map((item) => item.snapshotId));
  const evidence = new Set(snapshot.evidenceSpans.filter((item) =>
    hashes.has(item.artifactSha256) || snapshots.has(item.sourceSnapshotId)).map((item) => item.evidenceId));
  const versions = new Set([...CONSTRUCTED_VERSIONS, ...snapshot.provisionVersions.filter((item) =>
    CONSTRUCTED_VERSIONS.has(item.provisionVersionId) || item.evidenceIds.some((id) => evidence.has(id)))
    .map((item) => item.provisionVersionId)]);
  const claims = new Set(snapshot.applicabilityClaims.filter((item) =>
    versions.has(item.targetProvisionVersionId) || item.evidenceIds.some((id) => evidence.has(id)))
    .map((item) => item.claimId));
  const provisions = new Set(['prov-18-1001', 'prov-18-111'].filter((id) =>
    !snapshot.provisionVersions.some((version) => version.provisionId === id && !versions.has(version.provisionVersionId))));
  const assertions = new Set(snapshot.assertions.filter((item) =>
    CONSTRUCTED_ASSERTIONS.has(item.assertionId) || versions.has(item.subjectId) || versions.has(item.objectId ?? '') ||
    provisions.has(item.subjectId) || provisions.has(item.objectId ?? '') ||
    item.evidenceIds.some((id) => evidence.has(id)) || item.applicabilityClaimIds.some((id) => claims.has(id)))
    .map((item) => item.assertionId));
  return { artifactIds, hashes, snapshots, evidence, versions, claims, assertions };
}

function partialCoverages(snapshot: CatalogStateSnapshot): CatalogStateSnapshot['coverages'] {
  const present = new Set(snapshot.memberships.flatMap((membership) => {
    const version = snapshot.provisionVersions.find((item) => item.provisionVersionId === membership.provisionVersionId);
    return version ? [`${membership.sourceReleaseId}|title-${version.uscTitle}/section-${version.uscSection}`] : [];
  }));
  const affectedReleases = new Set(['pl-116-220', 'pl-119-73']);
  const affectedPartitions = new Set(['title-18/section-1001', 'title-18/section-111']);
  return snapshot.coverages.map((coverage) => {
    if (!coverage.releaseId || !affectedReleases.has(coverage.releaseId)) return coverage;
    const unavailable = coverage.expectedPartitions.filter((partition) =>
      affectedPartitions.has(partition) && !present.has(`${coverage.releaseId}|${partition}`));
    if (unavailable.length === 0) return coverage;
    const { lastCompletedAt: _lastCompletedAt, ...retained } = coverage;
    return { ...retained, coverageState: 'partial',
      completedPartitions: coverage.completedPartitions.filter((partition) => !unavailable.includes(partition)),
      failedPartitions: [...coverage.failedPartitions.filter((failure) => !unavailable.includes(failure.partition)),
        ...unavailable.map((partition) => ({ partition,
          reason: 'Constructed historical source withdrawn; independently retained source required.' }))] };
  });
}

/** Apply the source-integrity acceptance overlay described in ADR0002. */
export function containHistoricalSources(snapshot: CatalogStateSnapshot): CatalogStateSnapshot {
  const bad = withdrawnSources(snapshot);
  const accepted: CatalogStateSnapshot = {
    ...snapshot,
    artifacts: snapshot.artifacts.filter((item) => !bad.artifactIds.has(item.artifactId)),
    snapshots: snapshot.snapshots.filter((item) => !bad.snapshots.has(item.snapshotId)),
    releases: snapshot.releases.map((item) => ({ ...item,
      snapshotIds: item.snapshotIds.filter((id) => !bad.snapshots.has(id)) })),
    provisionVersions: snapshot.provisionVersions.filter((item) => !bad.versions.has(item.provisionVersionId)),
    memberships: snapshot.memberships.filter((item) => !bad.versions.has(item.provisionVersionId)),
    evidenceSpans: snapshot.evidenceSpans.filter((item) => !bad.evidence.has(item.evidenceId)),
    applicabilityClaims: snapshot.applicabilityClaims.filter((item) => !bad.claims.has(item.claimId)),
    assertions: snapshot.assertions.filter((item) => !bad.assertions.has(item.assertionId)),
    citationAssignments: snapshot.citationAssignments.filter((item) =>
      !item.evidenceIds.some((id) => bad.evidence.has(id))),
    identityTransitions: snapshot.identityTransitions.filter((item) =>
      !item.evidenceIds.some((id) => bad.evidence.has(id))),
    observations: snapshot.observations.filter((item) =>
      !(item.targetKind === 'provision_version' && bad.versions.has(item.targetId)) &&
      !(item.targetKind === 'legal_assertion' && bad.assertions.has(item.targetId)) &&
      !(item.targetKind === 'applicability_claim' && bad.claims.has(item.targetId))),
    findings: snapshot.findings.filter((item) => !bad.versions.has(item.targetId) &&
      !bad.assertions.has(item.targetId) && !bad.claims.has(item.targetId) &&
      !item.competingReadings.some((reading) => reading.evidenceIds.some((id) => bad.evidence.has(id)))),
    derivedArtifacts: snapshot.derivedArtifacts.filter((item) =>
      !item.dependencies.positiveInputs.some((hash) => bad.hashes.has(hash))),
  };
  const releases = acceptedReleaseMetadata(accepted);
  const affectedReleases = new Set(historicalSourceGaps(accepted).map((gap) => gap.releaseId));
  const legacyReleases = new Set(releases.filter((release) => release.legacyDerived && affectedReleases.has(release.releaseId))
    .map((release) => release.releaseId));
  const observations = accepted.observations.map((observation) => {
    if (observation.targetKind !== 'source_release' || !legacyReleases.has(observation.targetId)) return observation;
    const { sourcePublishedDate: _sourcePublishedDate, ...retained } = observation;
    return retained;
  });
  return { ...accepted, releases, observations, coverages: partialCoverages(accepted) };
}

export const HISTORICAL_SOURCE_CORRECTION = {
  eventId: 'evt-constructed-history-withdrawal-v1',
  observedAt: '2026-11-25T00:02:04.000Z',
  priorPublicationId: 'pub-pl-119-142-7297bf86fe00',
  reason: 'Constructed historical snapshots were withdrawn pending independently retained OLRC editions.',
  sourceUrl: 'https://uscode.house.gov/download/download.shtml',
} as const;

/** Independently constructed topic literals pass the same source acceptance boundary. */
export function containHistoricalTopic(
  topic: CuratedTopicDataset, snapshot: CatalogStateSnapshot,
): CuratedTopicDataset {
  const members = topic.memberProvisions.filter((member) => snapshot.memberships.some((membership) =>
    membership.sourceReleaseId === topic.currentReleaseId && membership.provisionId === member.provisionId));
  const constructed = topic.changeEvents.some((event) => CONSTRUCTED_TOPIC_EVENTS.has(event.eventId)) ||
    topic.relatedAuthorities.some((authority) => CONSTRUCTED_ASSERTIONS.has(authority.authorityId));
  if (members.length === topic.memberProvisions.length && !constructed) return topic;
  return { ...topic,
    summary: 'Historical topic source correction; retained legacy-derived provisions remain available for navigation.',
    scopeNote: `${HISTORICAL_SOURCE_CORRECTION.reason} PL116-220 and PL119-73 have partial coverage. Consult the OLRC source before relying on affected text.`,
    curator: 'Civic Source source-integrity review', lastReviewedAt: HISTORICAL_SOURCE_CORRECTION.observedAt,
    memberProvisions: members.map((member) => ({ ...member,
      roleInTopic: 'Retained legacy-derived navigation member; topical proposition awaiting source review.',
      editorialReview: 'unreviewed' })),
    relatedAuthorities: topic.relatedAuthorities.filter((authority) =>
      !CONSTRUCTED_ASSERTIONS.has(authority.authorityId) &&
      snapshot.assertions.some((assertion) => assertion.assertionId === authority.authorityId)),
    changeEvents: [{ eventId: HISTORICAL_SOURCE_CORRECTION.eventId, eventKind: 'source_conflict_quarantine',
      occurredAt: HISTORICAL_SOURCE_CORRECTION.observedAt, releaseId: 'pl-119-73',
      affectedCitation: '18 U.S.C. §§111,1001', title: 'Constructed historical snapshots withdrawn',
      summary: `${HISTORICAL_SOURCE_CORRECTION.reason} Prior publication: ${HISTORICAL_SOURCE_CORRECTION.priorPublicationId}.`,
      sourceUrl: HISTORICAL_SOURCE_CORRECTION.sourceUrl,
      priorPublicationId: HISTORICAL_SOURCE_CORRECTION.priorPublicationId,
      evidenceLocator: 'source-integrity:constructed-title18-v1' }],
  };
}

export function historicalSourceGaps(snapshot: CatalogStateSnapshot) {
  return ['pl-116-220', 'pl-119-73'].flatMap((releaseId) => ['111', '1001'].flatMap((section) => {
    const provisionId = `prov-18-${section}`;
    if (!snapshot.releases.some((release) => release.releaseId === releaseId) ||
      snapshot.memberships.some((member) => member.sourceReleaseId === releaseId && member.provisionId === provisionId)) return [];
    return [{ releaseId, provisionId, uscTitle: '18', uscSection: section,
      ...HISTORICAL_SOURCE_CORRECTION }];
  }));
}

export function historicalWithdrawalIdentifiers() {
  return { versionIds: [...CONSTRUCTED_VERSIONS], artifactDigests: [...CONSTRUCTED_DIGESTS] };
}

function acceptedReleaseMetadata(snapshot: CatalogStateSnapshot): CatalogStateSnapshot['releases'] {
  const affected = new Set(historicalSourceGaps(snapshot).map((gap) => gap.releaseId));
  return snapshot.releases.map((release) => {
    if (!affected.has(release.releaseId)) return release;
    const members = snapshot.memberships.filter((member) => member.sourceReleaseId === release.releaseId)
      .sort((left, right) => left.hierarchyPath.localeCompare(right.hierarchyPath));
    const versions = members.flatMap((member) => {
      const version = snapshot.provisionVersions.find((item) => item.provisionVersionId === member.provisionVersionId);
      return version ? [{ member, version }] : [];
    });
    if (!versions.every(({ version }) => version.legacyDerived)) return release;
    const tree = versions.map(({ member, version }) => `${member.hierarchyPath}:${version.normalizedContentHash}`).join('\n');
    const { publishedDate: _publishedDate, ...retained } = release;
    return { ...retained, legacyDerived: true,
      publisherReleaseLabel: `${release.releaseId} (legacy-derived Git cohort; source incomplete)`,
      releaseSegment: 'Partial legacy-derived Git cohort; constructed historical sources withdrawn.',
      manifestDigest: createHash('sha256').update(tree).digest('hex') };
  });
}

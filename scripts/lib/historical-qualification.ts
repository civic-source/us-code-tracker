import { createHash } from 'node:crypto';
import { ProvisionVersionSchema, type ProvisionVersion, SnapshotMembershipSchema } from '@civic-source/types';
import materialized from '../../data/olrc-history-pilot/materializations.json' with { type: 'json' };
import type { CatalogStateSnapshot } from './workbench-catalog.js';
import reviewed from '../../data/olrc-history-pilot/qualification.json' with { type: 'json' };

export function historicalRecordDigest(version: ProvisionVersion): string {
  return createHash('sha256').update(JSON.stringify(ProvisionVersionSchema.parse(version))).digest('hex');
}

/** Source claims require a reviewed materialization, not caller-controlled verification flags. */
export function requireHistoricalQualification(version: ProvisionVersion): void {
  if (!version.sourceQualification && !version.provisionVersionId.startsWith('pv-olrc-pilot-')) return;
  const records: ReadonlyArray<{ provisionVersionId: string; recordSha256: string }> = reviewed.records;
  const pin = records.find((record) => record.provisionVersionId === version.provisionVersionId);
  if (!pin || historicalRecordDigest(version) !== pin.recordSha256) {
    throw new Error('Historical source materialization has no matching reviewed source/body/rendering identity');
  }
}

/** Read-only database and export consumers share the same reviewed record identities. */
export function reviewedHistoricalVersions(): ProvisionVersion[] {
  return materialized.records.map(({ version }) => {
    const parsed = ProvisionVersionSchema.parse(version);
    requireHistoricalQualification(parsed);
    return parsed;
  });
}

export function historicalCollectionIdentity(releaseId: string): { releaseId: string; manifestDigest: string } {
  const ids = reviewedHistoricalVersions().filter(version => version.sourceQualification!.releaseId === releaseId)
    .map(version => version.provisionVersionId).sort();
  if (ids.length !== 3) throw new Error('Historical collection lacks the exact reviewed provision cohort');
  const manifestDigest = createHash('sha256').update(ids.join('\n')).digest('hex');
  return { releaseId: `olrc-pilot-${manifestDigest}`, manifestDigest };
}

export function historicalMembership(version: ProvisionVersion) {
  const qualification = version.sourceQualification!;
  return SnapshotMembershipSchema.parse({ membershipId: `mem-${version.provisionVersionId}`,
    sourceReleaseId: historicalCollectionIdentity(qualification.releaseId).releaseId,
    provisionVersionId: version.provisionVersionId, provisionId: version.provisionId,
    sourceOrder: Number(version.uscSection), hierarchyPath: `title-18/chapter-${version.uscChapter}/section-${version.uscSection}`,
    sourceLocator: `zip:sha256:${qualification.archiveSha256}!/usc18.xml#${qualification.sectionIdentifier}` });
}

/** Qualified membership cannot reassign an approved body to another collection or hierarchy. */
export function requireHistoricalCollections(snapshot: CatalogStateSnapshot): void {
  for (const member of snapshot.memberships) requireQualifiedMember(snapshot, member);
  for (const release of snapshot.releases.filter(item => item.releaseId.startsWith('olrc-pilot-'))) {
    const expected = historicalCollectionIdentity(release.publisherReleaseId ?? '');
    const members = snapshot.memberships.filter(item => item.sourceReleaseId === release.releaseId);
    const actual = createHash('sha256').update(members.map(item => item.provisionVersionId).sort().join('\n')).digest('hex');
    if (release.releaseId !== expected.releaseId || release.manifestDigest !== expected.manifestDigest ||
      release.legacyDerived || members.length !== 3 || actual !== expected.manifestDigest) throw new Error('Historical source collection identity or closure mismatch');
  }
}

function requireQualifiedMember(snapshot: CatalogStateSnapshot, member: CatalogStateSnapshot['memberships'][number]): void {
  const version = snapshot.provisionVersions.find(item => item.provisionVersionId === member.provisionVersionId);
  const sourceCollection = member.sourceReleaseId.startsWith('olrc-pilot-');
  if (!version?.sourceQualification) {
    if (sourceCollection) throw new Error('Historical source collection member is missing its qualified version');
    return;
  }
  const release = snapshot.releases.find(item => item.releaseId === member.sourceReleaseId);
  if (!release || release.publisherReleaseId !== version.sourceQualification.releaseId ||
    JSON.stringify(member) !== JSON.stringify(historicalMembership(version))) {
    throw new Error('Qualified historical membership differs from its reviewed source collection');
  }
}

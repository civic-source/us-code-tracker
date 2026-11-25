import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containHistoricalTopic } from '../lib/historical-withdrawal.js';
import type { CuratedTopicDataset } from '../lib/canonical-vertical-slice.js';
import { CanonicalWorkbenchCatalog, type CatalogStateSnapshot } from '../lib/workbench-catalog.js';

function cachedCatalog(): Partial<CatalogStateSnapshot> {
  return {
    releases: [{
      schemaVersion: 'usct.source-release/v1', releaseId: 'pl-119-73',
      publisherReleaseLabel: 'Public Law119-73', releaseSegment: 'cached bounded cohort',
      congress: 119, lawIdentifier: '73', exclusions: [], revisionNumber: 1,
      snapshotIds: [], coverageId: 'coverage', manifestDigest: 'a'.repeat(64),
      observedAt: '2026-11-22T06:30:00.000Z', legacyDerived: false,
    }],
    provisions: ['1001', '371'].map((section) => ({
      schemaVersion: 'usct.provision/v1', provisionId: `prov-18-${section}`,
      jurisdiction: 'US', documentKind: 'usc_section', creationBasis: 'test-only cached record',
      identityRegistryVersion: 1,
    })),
    provisionVersions: ['1001', '371'].map((section) => ({
      schemaVersion: 'usct.provision-version/v1', provisionVersionId: `pv-18-${section}-pl-119-73`,
      provisionId: `prov-18-${section}`, normalizedContentHash: 'b'.repeat(64),
      normalizationVersion: 'test-only', uscTitle: '18', uscChapter: '1', uscSection: section,
      heading: 'Test record', status: 'active', bodyMarkdown: section === '1001'
        ? 'Constructed table and175b reference must not be offered as official history.'
        : 'Unrelated legacy cohort control.',
      sourceCredits: [], notes: [], tables: [], unsupportedStructures: [], evidenceIds: [],
      legacyDerived: section === '371',
    })),
    memberships: ['1001', '371'].map((section, sourceOrder) => ({
      schemaVersion: 'usct.snapshot-membership/v1', membershipId: `member-${section}`,
      sourceReleaseId: 'pl-119-73', provisionVersionId: `pv-18-${section}-pl-119-73`,
      provisionId: `prov-18-${section}`, sourceOrder, hierarchyPath: `title-18/section-${section}`,
      sourceLocator: `test-only:${section}`,
    })),
    citationAssignments: ['1001', '371'].map((section) => ({
      schemaVersion: 'usct.citation-assignment/v1', assignmentId: `citation-${section}`,
      provisionId: `prov-18-${section}`, normalizedCitation: `18 U.S.C. ${section}`,
      legacySlug: `title-18/chapter-1/section-${section}`,
      releaseIds: ['pl-119-73'], evidenceIds: [], editorialReview: 'accepted',
    })),
  };
}

describe('constructed historical source containment', () => {
  it('does not present a cached constructed edition while preserving unrelated legacy history', () => {
    const catalog = new CanonicalWorkbenchCatalog();
    const accepted = catalog.ingestBundle(cachedCatalog());
    if (!accepted.ok) throw accepted.error;
    const result = catalog.queryAsPublished({ releaseId: 'pl-119-73', citation: '18 U.S.C. 1001' });
    expect(result.status).toBe('source_unavailable');
    expect(result.sourceCorrection?.eventId).toBe('evt-constructed-history-withdrawal-v1');
    expect(result.provisionVersion).toBeUndefined();
    const control = catalog.queryAsPublished({ releaseId: 'pl-119-73', citation: '18 U.S.C. 371' });
    expect(control.status).toBe('found');
    expect(control.provisionVersion?.bodyMarkdown).toBe('Unrelated legacy cohort control.');
  });
  it('replaying a cached catalog excludes withdrawn source dependencies from the saved export', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'historical-containment-'));
    try {
      const source = cachedCatalog();
      const digest = '477f966bb808315a1b9251408a41647bf3ae9764baa0a472f03dd12138fbc72e';
      source.artifacts = [{ schemaVersion: 'usct.source-artifact/v1', artifactId: 'art-uslm-18-1001-pl-119-73',
        sha256: digest, byteLength: 20, mediaType: 'application/xml', storageLocator: 'retained-fixture',
        license: 'unknown', attributionRequired: false }];
      source.snapshots = [{ schemaVersion: 'usct.source-snapshot/v1', snapshotId: 'bad-snapshot',
        sourceRegistryId: 'olrc-uslm', requestedUrl: 'https://uscode.house.gov/withdrawn-fixture',
        finalUrl: 'https://uscode.house.gov/withdrawn-fixture', publisher: 'OLRC', authorityKind: 'statute',
        artifactId: 'art-uslm-18-1001-pl-119-73', retrievedAt: '2026-11-22T06:30:00.000Z',
        publishedDatePrecision: 'unknown', legacyDerived: false }];
      source.evidenceSpans = [{ schemaVersion: 'usct.evidence-span/v1', evidenceId: 'bad-evidence',
        sourceSnapshotId: 'bad-snapshot', artifactSha256: digest, locatorKind: 'uslm_id',
        locatorValue: '/us/usc/t18/s1001/a', excerpt: 'Constructed175b clause',
        excerptSha256: 'c'.repeat(64), extractorVersion: 'fixture' }];
      source.applicabilityClaims = [{ schemaVersion: 'usct.applicability-claim/v1', claimId: 'bad-claim',
        targetProvisionVersionId: 'pv-18-1001-pl-119-73', applicabilityState: 'unknown',
        startBoundary: { state: 'unknown', precision: 'unknown', basis: 'unestablished', conditions: [], evidenceIds: [] },
        endBoundary: { state: 'unknown', precision: 'unknown', basis: 'unestablished', conditions: [], evidenceIds: [] },
        requiredContextFacts: [], evidenceIds: ['bad-evidence'], editorialReview: 'accepted', competingClaimIds: [] }];
      source.assertions = [{ schemaVersion: 'usct.legal-assertion/v1', assertionId: 'bad-assertion',
        subjectId: 'prov-18-371', relationType: 'cites', objectId: 'prov-18-1001', authorityKind: 'statute',
        extractionMethod: 'fixture', extractorVersion: 'fixture', extractionState: 'verified',
        editorialReview: 'accepted', versionAlignmentState: 'unknown', applicabilityClaimIds: ['bad-claim'],
        evidenceIds: ['bad-evidence'] }];
      source.findings = [{ findingId: 'dependent-finding', fingerprint: 'cached-finding', kind: 'source_conflict',
        affectedScope: '18 U.S.C. 1001', targetId: 'cached-finding-target', question: 'Cached resolution',
        competingReadings: [{ readingId: 'old-reading', summary: 'Resolved using withdrawn evidence', evidenceIds: ['bad-evidence'] }],
        status: 'resolved_editorial', owner: 'fixture', affectedOutputs: [] }];
      source.observations = [{ observationId: 'old-release-observation', targetKind: 'source_release',
        targetId: 'pl-119-73', observedAt: '2026-11-22T06:30:00.000Z', sourcePublishedDate: '2026-01-15',
        backfilledHistoricalSource: false }];
      const raw = JSON.stringify({ ...new CanonicalWorkbenchCatalog().getSnapshot(), ...source });
      const cached = join(directory, 'old-cache.json');
      await writeFile(cached, raw);
      const replayed = await CanonicalWorkbenchCatalog.loadFromFile(cached);
      const exported = join(directory, 'accepted-export.json');
      await replayed.saveToFile(exported);
      const output: unknown = JSON.parse(await readFile(exported, 'utf8'));
      expect(output).toMatchObject({ artifacts: [], snapshots: [], evidenceSpans: [], assertions: [], applicabilityClaims: [], findings: [] });
      expect(output).not.toHaveProperty('observations.0.sourcePublishedDate');
      expect(await readFile(cached, 'utf8')).toBe(raw);
      expect(replayed.queryAsPublished({ releaseId: 'pl-119-73', citation: '18 U.S.C. 371' }).status).toBe('found');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not export an observation claiming the withdrawn version was accepted', () => {
    const catalog = new CanonicalWorkbenchCatalog();
    const source = cachedCatalog();
    source.observations = [{ observationId: 'old-observation', targetKind: 'provision_version',
      targetId: 'pv-18-1001-pl-119-73', observedAt: '2026-11-22T06:30:00.000Z',
      backfilledHistoricalSource: false }];
    const accepted = catalog.ingestBundle(source);
    if (!accepted.ok) throw accepted.error;
    expect(catalog.getSnapshot().observations).toEqual([]);
  });

  it('withholds a stable-provision relationship when its only historical versions were withdrawn', () => {
    const catalog = new CanonicalWorkbenchCatalog();
    const source = cachedCatalog();
    source.assertions = [{ schemaVersion: 'usct.legal-assertion/v1', assertionId: 'unbound-authority',
      subjectId: 'prov-18-371', objectId: 'prov-18-1001', relationType: 'authority_citation',
      authorityKind: 'regulation', extractionMethod: 'cached-literal', extractorVersion: 'fixture',
      extractionState: 'verified', editorialReview: 'accepted', versionAlignmentState: 'unknown',
      evidenceIds: [], applicabilityClaimIds: [] }];
    const accepted = catalog.ingestBundle(source);
    if (!accepted.ok) throw accepted.error;
    expect(catalog.getSnapshot().assertions).toEqual([]);
  });

});

it('does not reaccept an old constructed topic event when a genuine replacement version later exists', () => {
  const snapshot = new CanonicalWorkbenchCatalog().getSnapshot();
  snapshot.memberships = [{ schemaVersion: 'usct.snapshot-membership/v1', membershipId: 'fresh-member',
    sourceReleaseId: 'pl-119-73', provisionVersionId: 'independently-retained-new-id', provisionId: 'prov-18-1001',
    sourceOrder: 0, hierarchyPath: 'title-18/section-1001', sourceLocator: 'retained-source' }];
  const topic: CuratedTopicDataset = { schemaVersion: 'usct.curated-topic/v1', topicSlug: 'false-statements-fraud',
    title: 'Cached topic', summary: 'Old producer', scopeNote: 'Old producer', curator: 'fixture',
    lastReviewedAt: '2026-11-22T00:00:00Z', currentReleaseId: 'pl-119-73',
    memberProvisions: [{ provisionId: 'prov-18-1001', citation: '18 U.S.C. 1001', heading: 'Cached', url: '/',
      roleInTopic: 'Cached claim', extractionState: 'verified', editorialReview: 'accepted', legacyDerived: false }],
    relatedAuthorities: [], changeEvents: [{ eventId: 'evt-18-1001-pl-119-73-amendment',
      eventKind: 'statutory_text_amendment', occurredAt: '2026-11-22T00:00:00Z', releaseId: 'pl-119-73',
      affectedCitation: '18 U.S.C. 1001', title: 'Old constructed amendment', summary: 'Old constructed claim',
      evidenceLocator: 'cached' }] };
  const accepted = containHistoricalTopic(topic, snapshot);
  expect(accepted.changeEvents.map((event) => event.eventId)).toEqual(['evt-constructed-history-withdrawal-v1']);
});

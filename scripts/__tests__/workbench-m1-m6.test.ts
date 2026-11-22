import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  CanonicalWorkbenchCatalog,
  FencedTaskCoordinator,
  buildHistoricalSearchShards,
  queryHistoricalSearchShard,
  computeDerivedArtifactKey,
  computeDependencyImpact,
  evaluateFindingRatchet,
  buildRelationshipNeighborhoodShard,
  runAnalyticalCoverageAudit,
  validateLocalModelDraft,
  exportRuleSpecCompatibleSlice,
  exportHckTaskAttemptReceipt,
  runPilotParityAndRecoveryDrill,
  type CatalogStateSnapshot,
  type DerivedArtifactRecord,
  type FindingRecord,
} from '../lib/workbench-catalog.js';

describe('Canonical Workbench Catalog & M1-M6 Capabilities (USCT-008..USCT-036)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'usct-workbench-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('Fixture A (USCT-008, USCT-009, USCT-013, USCT-034): separates publication time, knowledge time, and legal applicability (delayed, conditional, disputed, unknown)', async () => {
    const catalog = new CanonicalWorkbenchCatalog();

    const bundle: Partial<CatalogStateSnapshot> = {
      artifacts: [
        {
          schemaVersion: 'usct.source-artifact/v1',
          artifactId: 'art-aug',
          sha256: 'a'.repeat(64),
          byteLength: 10240,
          mediaType: 'application/xml',
          storageLocator: 'cas://sha256/' + 'a'.repeat(64),
          license: 'CC0-1.0',
          attributionRequired: false,
        },
        {
          schemaVersion: 'usct.source-artifact/v1',
          artifactId: 'art-sep-fix',
          sha256: 'b'.repeat(64),
          byteLength: 10300,
          mediaType: 'application/xml',
          storageLocator: 'cas://sha256/' + 'b'.repeat(64),
          license: 'CC0-1.0',
          attributionRequired: false,
        },
        {
          schemaVersion: 'usct.source-artifact/v1',
          artifactId: 'art-backfill',
          sha256: 'c'.repeat(64),
          byteLength: 9800,
          mediaType: 'application/xml',
          storageLocator: 'cas://sha256/' + 'c'.repeat(64),
          license: 'CC0-1.0',
          attributionRequired: false,
        },
      ],
      snapshots: [
        {
          schemaVersion: 'usct.source-snapshot/v1',
          snapshotId: 'snap-aug',
          sourceRegistryId: 'olrc-uslm',
          requestedUrl: 'https://uscode.house.gov/download/pls/26/pl-119-20.zip',
          finalUrl: 'https://uscode.house.gov/download/pls/26/pl-119-20.zip',
          publisher: 'OLRC',
          authorityKind: 'statute',
          artifactId: 'art-aug',
          retrievedAt: '2026-08-15T12:05:00Z',
          publisherReleaseLabel: '119-20',
          publishedDate: '2026-08-15',
          publishedDatePrecision: 'day',
          legacyDerived: false,
        },
        {
          schemaVersion: 'usct.source-snapshot/v1',
          snapshotId: 'snap-sep',
          sourceRegistryId: 'olrc-uslm',
          requestedUrl: 'https://uscode.house.gov/download/pls/26/pl-119-25.zip',
          finalUrl: 'https://uscode.house.gov/download/pls/26/pl-119-25.zip',
          publisher: 'OLRC',
          authorityKind: 'statute',
          artifactId: 'art-sep-fix',
          retrievedAt: '2026-09-10T12:05:00Z',
          publisherReleaseLabel: '119-25',
          publishedDate: '2026-09-10',
          publishedDatePrecision: 'day',
          legacyDerived: false,
        },
        {
          schemaVersion: 'usct.source-snapshot/v1',
          snapshotId: 'snap-backfill',
          sourceRegistryId: 'olrc-uslm',
          requestedUrl: 'https://uscode.house.gov/download/pls/26/pl-119-10.zip',
          finalUrl: 'https://uscode.house.gov/download/pls/26/pl-119-10.zip',
          publisher: 'OLRC',
          authorityKind: 'statute',
          artifactId: 'art-backfill',
          retrievedAt: '2026-10-05T12:05:00Z',
          publisherReleaseLabel: '119-10',
          publishedDate: '2026-07-01',
          publishedDatePrecision: 'day',
          legacyDerived: false,
        },
      ],
      releases: [
        {
          schemaVersion: 'usct.source-release/v1',
          releaseId: 'rel-jul',
          publisherReleaseLabel: 'Public Law 119-10',
          releaseSegment: '119/10',
          congress: 119,
          lawIdentifier: '10',
          exclusions: [],
          revisionNumber: 1,
          snapshotIds: ['snap-backfill'],
          coverageId: 'cov-jul',
          manifestDigest: '1'.repeat(64),
          publishedDate: '2026-07-01',
          observedAt: '2026-10-05T12:05:00Z',
          legacyDerived: false,
        },
        {
          schemaVersion: 'usct.source-release/v1',
          releaseId: 'rel-aug',
          publisherReleaseLabel: 'Public Law 119-20',
          releaseSegment: '119/20',
          congress: 119,
          lawIdentifier: '20',
          exclusions: [],
          revisionNumber: 1,
          snapshotIds: ['snap-aug'],
          coverageId: 'cov-aug',
          manifestDigest: '2'.repeat(64),
          publishedDate: '2026-08-15',
          observedAt: '2026-08-15T12:05:00Z',
          legacyDerived: false,
        },
        {
          schemaVersion: 'usct.source-release/v1',
          releaseId: 'rel-sep',
          publisherReleaseLabel: 'Public Law 119-25',
          releaseSegment: '119/25',
          congress: 119,
          lawIdentifier: '25',
          exclusions: [],
          revisionNumber: 1,
          snapshotIds: ['snap-sep'],
          coverageId: 'cov-sep',
          manifestDigest: '3'.repeat(64),
          publishedDate: '2026-09-10',
          observedAt: '2026-09-10T12:05:00Z',
          legacyDerived: false,
        },
      ],
      provisions: [
        {
          schemaVersion: 'usct.provision/v1',
          provisionId: 'prov-26-9999',
          jurisdiction: 'US',
          documentKind: 'usc_section',
          creationBasis: 'olrc_uslm_id:/us/usc/t26/s9999',
          identityRegistryVersion: 1,
        },
      ],
      provisionVersions: [
        {
          schemaVersion: 'usct.provision-version/v1',
          provisionVersionId: 'pv-26-9999-jul-backfill',
          provisionId: 'prov-26-9999',
          normalizedContentHash: '1'.repeat(64),
          normalizationVersion: '1.0.0',
          uslmIdentifier: '/us/usc/t26/s9999',
          uscTitle: '26',
          uscChapter: '1',
          uscSection: '9999',
          heading: '§ 9999. Pre-amendment energy credit',
          status: 'active',
          bodyMarkdown: 'Prior baseline credit of 10 percent.',
          sourceCredits: [],
          notes: [],
          tables: [],
          unsupportedStructures: [],
          evidenceIds: ['ev-note-1'],
          legacyDerived: false,
        },
        {
          schemaVersion: 'usct.provision-version/v1',
          provisionVersionId: 'pv-26-9999-aug',
          provisionId: 'prov-26-9999',
          normalizedContentHash: '2'.repeat(64),
          normalizationVersion: '1.0.0',
          uslmIdentifier: '/us/usc/t26/s9999',
          uscTitle: '26',
          uscChapter: '1',
          uscSection: '9999',
          heading: '§ 9999. Clean energy transition credit (August release)',
          status: 'active',
          bodyMarkdown: '(a) General credit of 30 percent.\n(b) Taxable years beginning after Dec 31, 2026.',
          sourceCredits: [],
          notes: [
            {
              noteId: 'note-eff-1',
              role: 'effective_date',
              heading: 'Effective Date of 2026 Amendment',
              text: 'Subsection (a) takes effect Jan 1, 2027. Subsection (b) applies to taxable years beginning after Dec 31, 2026.',
              locator: '/us/usc/t26/s9999/note[1]',
            },
          ],
          tables: [],
          unsupportedStructures: [],
          evidenceIds: ['ev-note-1'],
          legacyDerived: false,
        },
        {
          schemaVersion: 'usct.provision-version/v1',
          provisionVersionId: 'pv-26-9999-sep',
          provisionId: 'prov-26-9999',
          normalizedContentHash: '3'.repeat(64),
          normalizationVersion: '1.0.0',
          uslmIdentifier: '/us/usc/t26/s9999',
          uscTitle: '26',
          uscChapter: '1',
          uscSection: '9999',
          heading: '§ 9999. Clean energy transition credit (September editorial correction)',
          status: 'active',
          bodyMarkdown: '(a) General credit of 30 percent (corrected cross-reference).\n(b) Taxable years beginning after Dec 31, 2026.',
          sourceCredits: [],
          notes: [],
          tables: [],
          unsupportedStructures: [],
          evidenceIds: ['ev-note-1'],
          legacyDerived: false,
        },
      ],
      memberships: [
        {
          schemaVersion: 'usct.snapshot-membership/v1',
          membershipId: 'mem-jul',
          sourceReleaseId: 'rel-jul',
          provisionVersionId: 'pv-26-9999-jul-backfill',
          provisionId: 'prov-26-9999',
          sourceOrder: 1,
          hierarchyPath: 'title-26/chapter-1/section-9999',
          sourceLocator: '/us/usc/t26/s9999',
        },
        {
          schemaVersion: 'usct.snapshot-membership/v1',
          membershipId: 'mem-aug',
          sourceReleaseId: 'rel-aug',
          provisionVersionId: 'pv-26-9999-aug',
          provisionId: 'prov-26-9999',
          sourceOrder: 1,
          hierarchyPath: 'title-26/chapter-1/section-9999',
          sourceLocator: '/us/usc/t26/s9999',
        },
        {
          schemaVersion: 'usct.snapshot-membership/v1',
          membershipId: 'mem-sep',
          sourceReleaseId: 'rel-sep',
          provisionVersionId: 'pv-26-9999-sep',
          provisionId: 'prov-26-9999',
          sourceOrder: 1,
          hierarchyPath: 'title-26/chapter-1/section-9999',
          sourceLocator: '/us/usc/t26/s9999',
        },
      ],
      citationAssignments: [
        {
          schemaVersion: 'usct.citation-assignment/v1',
          assignmentId: 'ca-26-9999',
          provisionId: 'prov-26-9999',
          normalizedCitation: '26 U.S.C. 9999',
          legacySlug: 'title-26/chapter-1/section-9999',
          publisherIdentifier: '/us/usc/t26/s9999',
          releaseIds: ['rel-jul', 'rel-aug', 'rel-sep'],
          evidenceIds: ['ev-note-1'],
          editorialReview: 'accepted',
        },
      ],
      observations: [
        {
          observationId: 'obs-aug',
          targetKind: 'provision_version',
          targetId: 'pv-26-9999-aug',
          observedAt: '2026-08-15T12:05:00Z',
          sourcePublishedDate: '2026-08-15',
          backfilledHistoricalSource: false,
        },
        {
          observationId: 'obs-sep',
          targetKind: 'provision_version',
          targetId: 'pv-26-9999-sep',
          observedAt: '2026-09-10T12:05:00Z',
          sourcePublishedDate: '2026-09-10',
          backfilledHistoricalSource: false,
        },
        {
          observationId: 'obs-jul-backfill',
          targetKind: 'provision_version',
          targetId: 'pv-26-9999-jul-backfill',
          observedAt: '2026-10-05T12:05:00Z',
          sourcePublishedDate: '2026-07-01',
          backfilledHistoricalSource: true,
        },
      ],
      evidenceSpans: [
        {
          schemaVersion: 'usct.evidence-span/v1',
          evidenceId: 'ev-note-1',
          sourceSnapshotId: 'snap-aug',
          artifactSha256: 'a'.repeat(64),
          locatorKind: 'xml_path',
          locatorValue: '/us/usc/t26/s9999/note[1]',
          excerpt: 'Subsection (a) takes effect Jan 1, 2027. Subsection (b) applies to taxable years beginning after Dec 31, 2026.',
          excerptSha256: 'e'.repeat(64),
          extractorVersion: '2.0.0',
        },
      ],
      applicabilityClaims: [
        {
          schemaVersion: 'usct.applicability-claim/v1',
          claimId: 'app-subsec-a-delayed',
          targetProvisionVersionId: 'pv-26-9999-aug',
          targetSubdivisionLocator: 'subsection (a)',
          applicabilityState: 'known',
          startBoundary: {
            state: 'known',
            value: '2027-01-01',
            precision: 'day',
            inclusive: true,
            originalWording: 'takes effect Jan 1, 2027',
            conditions: [],
            basis: 'explicit_effective_date_clause',
            evidenceIds: ['ev-note-1'],
          },
          endBoundary: {
            state: 'open',
            precision: 'unknown',
            conditions: [],
            basis: 'unestablished',
            evidenceIds: [],
          },
          requiredContextFacts: [],
          evidenceIds: ['ev-note-1'],
          editorialReview: 'accepted',
          competingClaimIds: [],
        },
        {
          schemaVersion: 'usct.applicability-claim/v1',
          claimId: 'app-subsec-a-null-end-unknown',
          targetProvisionVersionId: 'pv-26-9999-aug',
          targetSubdivisionLocator: 'subsection (a-unknown-end)',
          applicabilityState: 'unknown',
          startBoundary: {
            state: 'known',
            value: '2027-01-01',
            precision: 'day',
            inclusive: true,
            conditions: [],
            basis: 'explicit_effective_date_clause',
            evidenceIds: ['ev-note-1'],
          },
          endBoundary: {
            state: 'unknown',
            precision: 'unknown',
            conditions: [],
            basis: 'unestablished',
            evidenceIds: [],
          },
          requiredContextFacts: [],
          evidenceIds: ['ev-note-1'],
          editorialReview: 'unreviewed',
          competingClaimIds: [],
        },
        {
          schemaVersion: 'usct.applicability-claim/v1',
          claimId: 'app-subsec-b-conditional',
          targetProvisionVersionId: 'pv-26-9999-aug',
          targetSubdivisionLocator: 'subsection (b)',
          applicabilityState: 'conditional',
          startBoundary: {
            state: 'conditional',
            value: '2027-01-01',
            precision: 'day',
            inclusive: true,
            conditions: ['tax_year_after_2026'],
            basis: 'conditional_trigger',
            evidenceIds: ['ev-note-1'],
          },
          endBoundary: {
            state: 'open',
            precision: 'unknown',
            conditions: [],
            basis: 'unestablished',
            evidenceIds: [],
          },
          requiredContextFacts: ['tax_year_after_2026'],
          evidenceIds: ['ev-note-1'],
          editorialReview: 'accepted',
          competingClaimIds: [],
        },
        {
          schemaVersion: 'usct.applicability-claim/v1',
          claimId: 'app-subsec-c-disputed',
          targetProvisionVersionId: 'pv-26-9999-aug',
          targetSubdivisionLocator: 'subsection (c)',
          applicabilityState: 'disputed',
          startBoundary: {
            state: 'unknown',
            precision: 'unknown',
            conditions: [],
            basis: 'unestablished',
            evidenceIds: ['ev-note-1'],
          },
          endBoundary: {
            state: 'unknown',
            precision: 'unknown',
            conditions: [],
            basis: 'unestablished',
            evidenceIds: [],
          },
          requiredContextFacts: [],
          evidenceIds: ['ev-note-1'],
          editorialReview: 'disputed',
          competingClaimIds: ['app-subsec-c-alt'],
        },
      ],
    };

    const ingestRes = catalog.ingestBundle(bundle);
    expect(ingestRes.ok).toBe(true);

    // 1. As-published query for August vs September vs July releases
    const augPublished = catalog.queryAsPublished({ releaseId: 'rel-aug', citation: '26 U.S.C. 9999' });
    expect(augPublished.status).toBe('found');
    expect(augPublished.provisionVersion?.provisionVersionId).toBe('pv-26-9999-aug');

    const sepPublished = catalog.queryAsPublished({ releaseId: 'rel-sep', citation: '26 U.S.C. 9999' });
    expect(sepPublished.provisionVersion?.provisionVersionId).toBe('pv-26-9999-sep');

    // 2. Knowledge-time invariant: July release was backfilled on Oct 5, 2026.
    // Querying what the system knew as of Sep 1, 2026 returns the August observation (and never leaks the Oct 5 backfill or Sep 10 fix!)
    const knownSep1 = catalog.queryKnownAsOf({
      cutoffObservedAt: '2026-09-01T00:00:00Z',
      citation: '26 U.S.C. 9999',
    });
    expect(knownSep1.status).toBe('known_at_cutoff');
    expect(knownSep1.provisionVersion?.provisionVersionId).toBe('pv-26-9999-aug');

    // Querying before Aug 15, 2026 (e.g. July 15, 2026) reports unknown_at_cutoff_backfilled_later
    const knownJul15 = catalog.queryKnownAsOf({
      cutoffObservedAt: '2026-07-15T00:00:00Z',
      citation: '26 U.S.C. 9999',
    });
    expect(knownJul15.status).toBe('unknown_at_cutoff_backfilled_later');

    // 3. Legal applicability query on Oct 1, 2026 (before Jan 1, 2027 delayed effective date)
    const appSubsecAOct2026 = catalog.queryLegallyApplicable({
      requestedLegalDate: '2026-10-01',
      citation: '26 U.S.C. 9999',
      subdivisionLocator: 'subsection (a)',
    });
    expect(appSubsecAOct2026.applicabilityState).toBe('unknown');
    expect(appSubsecAOct2026.matchingClaims).toHaveLength(0);

    // 4. Legal applicability query on Feb 1, 2027 (after Jan 1, 2027 effective date with explicit open end boundary)
    const appSubsecAFeb2027 = catalog.queryLegallyApplicable({
      requestedLegalDate: '2027-02-01',
      citation: '26 U.S.C. 9999',
      subdivisionLocator: 'subsection (a)',
    });
    expect(appSubsecAFeb2027.applicabilityState).toBe('known');
    expect(appSubsecAFeb2027.matchingClaims).toHaveLength(1);

    // 5. USCT-034 invariant: null/unknown end boundary NEVER implies ongoing validity
    const appUnknownEnd = catalog.queryLegallyApplicable({
      requestedLegalDate: '2027-02-01',
      citation: '26 U.S.C. 9999',
      subdivisionLocator: 'subsection (a-unknown-end)',
    });
    expect(appUnknownEnd.applicabilityState).toBe('unknown');

    // 6. Conditional applicability without required context fact vs with context fact
    const appConditionalMissing = catalog.queryLegallyApplicable({
      requestedLegalDate: '2027-02-01',
      citation: '26 U.S.C. 9999',
      subdivisionLocator: 'subsection (b)',
    });
    expect(appConditionalMissing.applicabilityState).toBe('conditional');
    expect(appConditionalMissing.missingContextFacts).toContain('tax_year_after_2026');

    const appConditionalSatisfied = catalog.queryLegallyApplicable({
      requestedLegalDate: '2027-02-01',
      citation: '26 U.S.C. 9999',
      subdivisionLocator: 'subsection (b)',
      contextFacts: { tax_year_after_2026: true },
    });
    expect(appConditionalSatisfied.applicabilityState).toBe('known');

    // 7. Disputed applicability
    const appDisputed = catalog.queryLegallyApplicable({
      requestedLegalDate: '2027-02-01',
      citation: '26 U.S.C. 9999',
      subdivisionLocator: 'subsection (c)',
    });
    expect(appDisputed.applicabilityState).toBe('disputed');

    // 8. File-backed persistence & clean replay parity
    const filePath = path.join(tmpDir, 'catalog.json');
    await catalog.saveToFile(filePath);
    const replayed = await CanonicalWorkbenchCatalog.loadFromFile(filePath);
    expect(
      replayed.queryLegallyApplicable({
        requestedLegalDate: '2027-02-01',
        citation: '26 U.S.C. 9999',
        subdivisionLocator: 'subsection (a)',
      }),
    ).toEqual(appSubsecAFeb2027);

    // 9. PostgreSQL DDL & Transactional SQL Adapter parity + rollback check (USCT-009)
    const ddl = CanonicalWorkbenchCatalog.getPostgresMigrationSql();
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS provision_versions');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS applicability_claims');

    const executedStatements: Array<{ sql: string; params?: readonly unknown[] }> = [];
    const committedTables = new Map<string, number>();
    const sqlAdapter = {
      async execute(sql: string, params?: readonly unknown[]) {
        executedStatements.push({ sql, ...(params ? { params } : {}) });
        if (sql.startsWith('INSERT INTO ')) {
          const table = sql.split(/\s+/)[2] ?? 'unknown';
          committedTables.set(table, (committedTables.get(table) ?? 0) + 1);
        }
        return { rows: [] };
      },
    };
    const sqlSyncRes = await catalog.syncToSqlAdapter(sqlAdapter);
    expect(sqlSyncRes.ok).toBe(true);
    if (sqlSyncRes.ok) {
      expect(sqlSyncRes.value.tablesWritten).toBe(6);
      expect(sqlSyncRes.value.rowsUpserted).toBe(17);
    }
    expect(executedStatements.some((s) => s.sql === 'BEGIN')).toBe(true);
    expect(executedStatements.some((s) => s.sql === 'COMMIT')).toBe(true);

    // Verify transactional ROLLBACK when an error occurs mid-transaction
    const rollbackStatements: string[] = [];
    const failingAdapter = {
      async execute(sql: string) {
        rollbackStatements.push(sql);
        if (sql.includes('INSERT INTO provision_versions')) {
          throw new Error('Simulated DB constraint failure');
        }
        return { rows: [] };
      },
    };
    const failedSync = await catalog.syncToSqlAdapter(failingAdapter);
    expect(failedSync.ok).toBe(false);
    expect(rollbackStatements).toContain('ROLLBACK');
  });

  it('Fixture B (USCT-011, USCT-015): handles citation transfers, citation reuse, and ambiguous splits without overwriting prior provisions', () => {
    const catalog = new CanonicalWorkbenchCatalog();

    const ingestRes = catalog.ingestBundle({
      provisions: [
        {
          schemaVersion: 'usct.provision/v1',
          provisionId: 'prov-orig-A',
          jurisdiction: 'US',
          documentKind: 'usc_section',
          creationBasis: 'olrc_uslm_id:/us/usc/t42/s1000-orig',
          identityRegistryVersion: 1,
        },
        {
          schemaVersion: 'usct.provision/v1',
          provisionId: 'prov-reused-A',
          jurisdiction: 'US',
          documentKind: 'usc_section',
          creationBasis: 'olrc_uslm_id:/us/usc/t42/s1000-new',
          identityRegistryVersion: 1,
        },
        {
          schemaVersion: 'usct.provision/v1',
          provisionId: 'prov-split-B1',
          jurisdiction: 'US',
          documentKind: 'usc_section',
          creationBasis: 'olrc_uslm_id:/us/usc/t42/s2000a',
          identityRegistryVersion: 1,
        },
        {
          schemaVersion: 'usct.provision/v1',
          provisionId: 'prov-split-B2',
          jurisdiction: 'US',
          documentKind: 'usc_section',
          creationBasis: 'olrc_uslm_id:/us/usc/t42/s2000b',
          identityRegistryVersion: 1,
        },
      ],
      citationAssignments: [
        {
          schemaVersion: 'usct.citation-assignment/v1',
          assignmentId: 'cit-1990-A',
          provisionId: 'prov-orig-A',
          normalizedCitation: '42 U.S.C. 1000',
          legacySlug: 'title-42/chapter-1/section-1000',
          releaseIds: ['rel-1990'],
          evidenceIds: [],
          editorialReview: 'accepted',
        },
        {
          schemaVersion: 'usct.citation-assignment/v1',
          assignmentId: 'cit-2010-B',
          provisionId: 'prov-orig-A',
          normalizedCitation: '42 U.S.C. 2000',
          legacySlug: 'title-42/chapter-1/section-2000',
          releaseIds: ['rel-2010'],
          evidenceIds: [],
          editorialReview: 'accepted',
        },
        {
          schemaVersion: 'usct.citation-assignment/v1',
          assignmentId: 'cit-2010-reused-A',
          provisionId: 'prov-reused-A',
          normalizedCitation: '42 U.S.C. 1000',
          legacySlug: 'title-42/chapter-1/section-1000',
          releaseIds: ['rel-2010'],
          evidenceIds: [],
          editorialReview: 'accepted',
        },
      ],
      identityTransitions: [
        {
          schemaVersion: 'usct.identity-transition/v1',
          transitionId: 'tr-transfer-A-to-B',
          transitionKind: 'transferred_to',
          fromProvisionId: 'prov-orig-A',
          fromCitation: '42 U.S.C. 1000',
          toProvisionIds: ['prov-orig-A'],
          toCitations: ['42 U.S.C. 2000'],
          effectiveReleaseId: 'rel-1990',
          extractionState: 'verified',
          editorialReview: 'accepted',
          evidenceIds: [],
        },
        {
          schemaVersion: 'usct.identity-transition/v1',
          transitionId: 'tr-ambiguous-split',
          transitionKind: 'split_into',
          fromProvisionId: 'prov-orig-A',
          fromCitation: '42 U.S.C. 2000',
          toProvisionIds: ['prov-split-B1', 'prov-split-B2'],
          toCitations: ['42 U.S.C. 2000a', '42 U.S.C. 2000b'],
          effectiveReleaseId: 'rel-2010',
          extractionState: 'candidate',
          editorialReview: 'unreviewed',
          ambiguityNote: 'Provision split into § 2000a and § 2000b with overlapping subject matter.',
          evidenceIds: [],
        },
      ],
    });
    expect(ingestRes.ok).toBe(true);

    // Resolving "42 U.S.C. 1000" in the 1990 release returns original Provision A (and its transfer status)
    const resolved1990 = catalog.resolveCitation('42 U.S.C. 1000', 'rel-1990');
    expect(resolved1990.provisionId).toBe('prov-orig-A');
    expect(resolved1990.status).toBe('transferred');

    // Resolving "42 U.S.C. 1000" without a release context detects citation reuse across two distinct provisions
    const resolvedAll = catalog.resolveCitation('42 U.S.C. 1000');
    expect(resolvedAll.status).toBe('ambiguous_unresolved');
    expect(resolvedAll.candidateProvisionIds.sort()).toEqual(['prov-orig-A', 'prov-reused-A']);

    // Resolving "42 U.S.C. 2000" in 2010 surfaces the ambiguous split
    const resolvedSplit = catalog.resolveCitation('42 U.S.C. 2000', 'rel-2010');
    expect(resolvedSplit.status).toBe('ambiguous_unresolved');
    expect(resolvedSplit.candidateProvisionIds).toEqual(['prov-split-B1', 'prov-split-B2']);
  });

  it('M3 Dependency Invalidation & Impact Preview (USCT-018): detects positive, collection, negative (missing citation resolution), and policy invalidations', () => {
    const key1 = computeDerivedArtifactKey({
      artifactKind: 'relationship_neighborhood',
      targetScope: '18-1001',
      producerId: 'neighborhood-builder',
      producerVersion: '1.0.0',
      schemaVersion: '1.0.0',
      configDigest: 'cfg-1',
      dependencies: {
        positiveInputs: ['hash-a', 'hash-b'],
        collectionInputs: ['coll-1'],
        negativeInputs: ['missing-target:42-usc-9999'],
        policyInputs: ['policy-1'],
      },
    });

    const key1Duplicate = computeDerivedArtifactKey({
      artifactKind: 'relationship_neighborhood',
      targetScope: '18-1001',
      producerId: 'neighborhood-builder',
      producerVersion: '1.0.0',
      schemaVersion: '1.0.0',
      configDigest: 'cfg-1',
      dependencies: {
        positiveInputs: ['hash-b', 'hash-a'], // Order-independent
        collectionInputs: ['coll-1'],
        negativeInputs: ['missing-target:42-usc-9999'],
        policyInputs: ['policy-1'],
      },
    });
    expect(key1).toBe(key1Duplicate);

    const artifacts: DerivedArtifactRecord[] = [
      {
        artifactKey: 'shard-pos',
        artifactKind: 'historical_search_shard',
        targetScope: 'pl-119-73:title-18',
        producerId: 'shard-builder',
        producerVersion: '1.0.0',
        schemaVersion: '1.0.0',
        configDigest: 'cfg-1',
        dependencies: {
          positiveInputs: ['hash-a'],
          collectionInputs: ['coll-1'],
          negativeInputs: [],
          policyInputs: ['policy-1'],
        },
        outputContentHash: 'out-1',
      },
      {
        artifactKey: 'shard-neg',
        artifactKind: 'relationship_neighborhood',
        targetScope: '18-1001',
        producerId: 'neighborhood-builder',
        producerVersion: '1.0.0',
        schemaVersion: '1.0.0',
        configDigest: 'cfg-1',
        dependencies: {
          positiveInputs: ['hash-stable'],
          collectionInputs: ['coll-1'],
          negativeInputs: ['missing-target:42-usc-9999'],
          policyInputs: ['policy-1'],
        },
        outputContentHash: 'out-2',
      },
      {
        artifactKey: 'shard-clean',
        artifactKind: 'historical_search_shard',
        targetScope: 'pl-119-73:title-26',
        producerId: 'shard-builder',
        producerVersion: '1.0.0',
        schemaVersion: '1.0.0',
        configDigest: 'cfg-1',
        dependencies: {
          positiveInputs: ['hash-stable'],
          collectionInputs: ['coll-1'],
          negativeInputs: [],
          policyInputs: ['policy-1'],
        },
        outputContentHash: 'out-3',
      },
    ];

    const report = computeDependencyImpact(artifacts, {
      modifiedPositiveInputs: ['hash-a'],
      newlyPresentTargets: ['missing-target:42-usc-9999'],
    });

    expect(report.invalidatedArtifacts.map((a) => a.artifactKey)).toEqual(['shard-pos', 'shard-neg']);
    expect(report.unaffectedArtifacts.map((a) => a.artifactKey)).toEqual(['shard-clean']);
    expect(report.affectedPages).toEqual(['18-1001']);
    expect(report.affectedSearchShards).toEqual(['pl-119-73:title-18']);
  });

  it('M3 Fenced Task Coordinator (USCT-035): rejects late worker completion after lease expiration and superseding generation', () => {
    const coordinator = new FencedTaskCoordinator();

    // Worker A starts attempt 1
    const attemptA = coordinator.startAttempt({
      taskId: 'ingest:title-18',
      attemptId: 'att-A',
      inputIdentity: 'input-v1',
      ownerWorkerId: 'worker-A',
      nowMs: 1_000_000,
      leaseDurationMs: 60_000,
    });
    expect(attemptA.generation).toBe(1);
    expect(attemptA.fencingToken).toBe(1);

    // Worker A stalls. Worker B supersedes with attempt 2
    const attemptB = coordinator.startAttempt({
      taskId: 'ingest:title-18',
      attemptId: 'att-B',
      inputIdentity: 'input-v1',
      ownerWorkerId: 'worker-B',
      nowMs: 1_030_000,
      leaseDurationMs: 60_000,
    });
    expect(attemptB.generation).toBe(2);
    expect(attemptB.fencingToken).toBe(2);

    // Worker B proposes acceptance -> accepted
    const commitB = coordinator.proposeAcceptance({
      attemptId: attemptB.attemptId,
      outputArtifactHash: 'sha256-worker-b-valid',
      nowMs: 1_040_000,
    });
    expect(commitB.ok).toBe(true);

    // Worker A wakes up (even before its own lease expires!) and attempts to commit its stale generation/token
    const commitA = coordinator.proposeAcceptance({
      attemptId: attemptA.attemptId,
      outputArtifactHash: 'sha256-worker-a-stale',
      nowMs: 1_045_000,
    });
    expect(commitA.ok).toBe(false);
    if (!commitA.ok) {
      expect(commitA.error.message).toContain('Stale attempt fenced out');
    }
    expect(coordinator.getTaskState('ingest:title-18')?.acceptedOutputHash).toBe('sha256-worker-b-valid');
  });

  it('M3 Historical Release-Scoped Search Shards (USCT-036): isolates historical search results per release without leaking current text', () => {
    const catalog = new CanonicalWorkbenchCatalog();
    catalog.ingestBundle({
      releases: [
        {
          schemaVersion: 'usct.source-release/v1',
          releaseId: 'pl-118-10',
          publisherReleaseLabel: 'Public Law 118-10',
          releaseSegment: '118/10',
          congress: 118,
          lawIdentifier: '10',
          exclusions: [],
          revisionNumber: 1,
          snapshotIds: [],
          coverageId: 'cov-118',
          manifestDigest: '1'.repeat(64),
          observedAt: '2024-05-01T00:00:00Z',
          legacyDerived: false,
        },
        {
          schemaVersion: 'usct.source-release/v1',
          releaseId: 'pl-119-73',
          publisherReleaseLabel: 'Public Law 119-73',
          releaseSegment: '119/73',
          congress: 119,
          lawIdentifier: '73',
          exclusions: [],
          revisionNumber: 1,
          snapshotIds: [],
          coverageId: 'cov-119',
          manifestDigest: '2'.repeat(64),
          observedAt: '2026-11-01T00:00:00Z',
          legacyDerived: false,
        },
      ],
      provisions: [
        {
          schemaVersion: 'usct.provision/v1',
          provisionId: 'prov-18-1001',
          jurisdiction: 'US',
          documentKind: 'usc_section',
          creationBasis: 'olrc_uslm_id:/us/usc/t18/s1001',
          identityRegistryVersion: 1,
        },
      ],
      provisionVersions: [
        {
          schemaVersion: 'usct.provision-version/v1',
          provisionVersionId: 'pv-18-1001-118',
          provisionId: 'prov-18-1001',
          normalizedContentHash: '4'.repeat(64),
          normalizationVersion: '1.0.0',
          uscTitle: '18',
          uscChapter: '47',
          uscSection: '1001',
          heading: '§ 1001. Statements or entries generally',
          status: 'active',
          bodyMarkdown: 'Legacy quantum telegraph falsification penalty.',
          sourceCredits: [],
          notes: [],
          tables: [],
          unsupportedStructures: [],
          evidenceIds: [],
          legacyDerived: false,
        },
        {
          schemaVersion: 'usct.provision-version/v1',
          provisionVersionId: 'pv-18-1001-119',
          provisionId: 'prov-18-1001',
          normalizedContentHash: '5'.repeat(64),
          normalizationVersion: '1.0.0',
          uscTitle: '18',
          uscChapter: '47',
          uscSection: '1001',
          heading: '§ 1001. Statements or entries generally',
          status: 'active',
          bodyMarkdown: 'Modern autonomous synthetic ledger penalty.',
          sourceCredits: [],
          notes: [],
          tables: [],
          unsupportedStructures: [],
          evidenceIds: [],
          legacyDerived: false,
        },
      ],
      memberships: [
        {
          schemaVersion: 'usct.snapshot-membership/v1',
          membershipId: 'm-118',
          sourceReleaseId: 'pl-118-10',
          provisionVersionId: 'pv-18-1001-118',
          provisionId: 'prov-18-1001',
          sourceOrder: 1,
          hierarchyPath: 'title-18/chapter-47/section-1001',
          sourceLocator: '/us/usc/t18/s1001',
        },
        {
          schemaVersion: 'usct.snapshot-membership/v1',
          membershipId: 'm-119',
          sourceReleaseId: 'pl-119-73',
          provisionVersionId: 'pv-18-1001-119',
          provisionId: 'prov-18-1001',
          sourceOrder: 1,
          hierarchyPath: 'title-18/chapter-47/section-1001',
          sourceLocator: '/us/usc/t18/s1001',
        },
      ],
    });

    const { manifest, shards } = buildHistoricalSearchShards(catalog, 'pub-1');
    expect(manifest.availableReleases).toHaveLength(2);

    // Search release pl-118-10 for "telegraph" -> found with pinned historical URL
    const hit118 = queryHistoricalSearchShard({
      releaseId: 'pl-118-10',
      uscTitle: '18',
      query: 'telegraph',
      manifest,
      loadedShards: shards,
    });
    expect(hit118.status).toBe('ok');
    expect(hit118.results).toHaveLength(1);
    expect(hit118.results[0]?.historicalUrl).toContain('release=pl-118-10');

    // Search release pl-118-10 for "autonomous" (only in pl-119-73) -> 0 results (never leaks current text)
    const noLeak118 = queryHistoricalSearchShard({
      releaseId: 'pl-118-10',
      uscTitle: '18',
      query: 'autonomous',
      manifest,
      loadedShards: shards,
    });
    expect(noLeak118.status).toBe('ok');
    expect(noLeak118.results).toHaveLength(0);

    // Search unindexed title in pl-118-10 -> explicit shard_missing_or_uncollected status
    const missingShard = queryHistoricalSearchShard({
      releaseId: 'pl-118-10',
      uscTitle: '50',
      query: 'telegraph',
      manifest,
      loadedShards: shards,
    });
    expect(missingShard.status).toBe('shard_missing_or_uncollected');
    expect(missingShard.results).toHaveLength(0);
  });

  it('M2/M4/M5/M6 capabilities (USCT-017, USCT-021, USCT-022, USCT-023, USCT-024, USCT-032): verifies finding ratchet, neighborhood shards, analytical audits, lexical search, local model validation, and RuleSpec slice export', async () => {
    // 1. Finding ratchet (USCT-017)
    const sampleFinding: FindingRecord = {
      findingId: 'f-new',
      fingerprint: 'fp-ambig-18-1001',
      kind: 'ambiguous_citation_continuity',
      affectedScope: 'title-18',
      targetId: 'prov-18-1001',
      question: 'Which successor section receives subsec (d)?',
      competingReadings: [],
      status: 'open',
      owner: 'civic-source/legal-data',
      affectedOutputs: ['statute/title-18/chapter-47/section-1001'],
    };

    const ratchetFail = evaluateFindingRatchet({
      currentFindings: [sampleFinding],
      baselineFingerprints: new Set(),
      nowIso: '2026-11-21T12:00:00Z',
    });
    expect(ratchetFail.passed).toBe(false);
    expect(ratchetFail.newUnapprovedFindings).toHaveLength(1);

    // Stale baseline fingerprint that was fixed MUST fail until baseline is shrunk
    const ratchetStale = evaluateFindingRatchet({
      currentFindings: [],
      baselineFingerprints: new Set(['fp-already-fixed']),
      nowIso: '2026-11-21T12:00:00Z',
    });
    expect(ratchetStale.passed).toBe(false);
    expect(ratchetStale.staleFixedWaivers).toEqual(['fp-already-fixed']);

    // 2. Local model draft validation & workbench capabilities (USCT-021, USCT-022, USCT-023, USCT-024, USCT-032)
    const catalog = new CanonicalWorkbenchCatalog();
    const evSpan = {
      schemaVersion: 'usct.evidence-span/v1' as const,
      evidenceId: 'ev-18-1001-a',
      sourceSnapshotId: 'snap-119-73',
      artifactSha256: '9'.repeat(64),
      locatorKind: 'uslm_id' as const,
      locatorValue: '/us/usc/t18/s1001/a',
      excerpt: 'Whoever knowingly and willfully falsifies, conceals, or covers up by any trick...',
      excerptSha256: '8'.repeat(64),
      extractorVersion: '2.0.0',
    };

    catalog.ingestBundle({
      releases: [
        {
          schemaVersion: 'usct.source-release/v1',
          releaseId: 'rel-119-73',
          publisherReleaseLabel: 'PL 119-73',
          releaseSegment: '119/73',
          congress: 119,
          lawIdentifier: '73',
          exclusions: [],
          revisionNumber: 1,
          snapshotIds: ['snap-119-73'],
          coverageId: 'cov-ecfr-18',
          manifestDigest: '9'.repeat(64),
          observedAt: '2026-11-21T00:00:00Z',
          legacyDerived: false,
        },
      ],
      provisions: [
        {
          schemaVersion: 'usct.provision/v1',
          provisionId: 'prov-18-1001',
          jurisdiction: 'US',
          documentKind: 'usc_section',
          creationBasis: 'olrc_uslm_id:/us/usc/t18/s1001',
          identityRegistryVersion: 1,
        },
      ],
      provisionVersions: [
        {
          schemaVersion: 'usct.provision-version/v1',
          provisionVersionId: 'pv-18-1001-curr',
          provisionId: 'prov-18-1001',
          normalizedContentHash: '9'.repeat(64),
          normalizationVersion: '1.0.0',
          uscTitle: '18',
          uscChapter: '47',
          uscSection: '1001',
          heading: '§ 1001. Statements or entries generally',
          status: 'active',
          bodyMarkdown: 'Whoever knowingly and willfully falsifies, conceals, or covers up by any trick...',
          sourceCredits: [],
          notes: [],
          tables: [],
          unsupportedStructures: [],
          evidenceIds: ['ev-18-1001-a'],
          legacyDerived: false,
        },
      ],
      memberships: [
        {
          schemaVersion: 'usct.snapshot-membership/v1',
          membershipId: 'mem-18-1001',
          sourceReleaseId: 'rel-119-73',
          provisionVersionId: 'pv-18-1001-curr',
          provisionId: 'prov-18-1001',
          sourceOrder: 1,
          hierarchyPath: 'title-18/chapter-47/section-1001',
          sourceLocator: '/us/usc/t18/s1001',
        },
      ],
      evidenceSpans: [evSpan],
      assertions: [
        {
          schemaVersion: 'usct.legal-assertion/v1',
          assertionId: 'as-reg-1',
          subjectId: 'prov-18-1001',
          relationType: 'authority_citation',
          objectId: '28-cfr-part-45',
          authorityKind: 'regulation',
          extractionMethod: 'ecfr-ptoa-verifier',
          extractorVersion: '1.0.0',
          extractionState: 'verified',
          editorialReview: 'accepted',
          versionAlignmentState: 'verified',
          applicabilityClaimIds: [],
          evidenceIds: ['ev-18-1001-a'],
        },
      ],
      coverages: [
        {
          schemaVersion: 'usct.collection-coverage/v1',
          coverageId: 'cov-ecfr-18',
          sourceScope: 'ecfr:title-18',
          sourceFamily: 'ecfr',
          releaseId: 'rel-119-73',
          expectedPartitions: ['part-1', 'part-2'],
          completedPartitions: ['part-1'],
          absentPartitions: [],
          failedPartitions: [{ partition: 'part-2', reason: 'HTTP 503' }],
          coverageState: 'partial',
          lastAttemptedAt: '2026-11-21T00:00:00Z',
          isRequiredForPublication: false,
        },
      ],
    });

    const badDraft = validateLocalModelDraft({
      modelId: 'gemma-3-27b-it-local',
      modelWeightsDigest: 'sha256:gemma3',
      promptTemplateVersion: '1.0.0',
      inputProvisionVersionIds: ['pv-18-1001-curr'],
      availableEvidenceSpans: [evSpan],
      draftSummary: 'Unsupported hallucinated claim.',
      citedEvidenceIds: ['ev-nonexistent'],
    });
    expect(badDraft.validationPassed).toBe(false);
    expect(badDraft.editorialReview).toBe('rejected');

    const goodDraft = validateLocalModelDraft({
      modelId: 'gemma-3-27b-it-local',
      modelWeightsDigest: 'sha256:gemma3',
      promptTemplateVersion: '1.0.0',
      inputProvisionVersionIds: ['pv-18-1001-curr'],
      availableEvidenceSpans: [evSpan],
      draftSummary: 'Prohibits knowingly and willfully falsifying material facts.',
      citedEvidenceIds: ['ev-18-1001-a'],
    });
    expect(goodDraft.validationPassed).toBe(true);
    expect(goodDraft.extractionState).toBe('candidate');
    expect(goodDraft.editorialReview).toBe('unreviewed');

    // 3. Lexical search with release filter (USCT-023)
    const lexHits = catalog.searchWorkbenchLexical({
      query: 'knowingly falsifies',
      releaseId: 'rel-119-73',
      uscTitle: '18',
    });
    expect(lexHits).toHaveLength(1);
    expect(lexHits[0]?.provisionVersionId).toBe('pv-18-1001-curr');

    // 4. Relationship neighborhood shard & analytical audit (USCT-021, USCT-022)
    const shard = buildRelationshipNeighborhoodShard(catalog, 'prov-18-1001', 'rel-119-73');
    expect(shard.provisionId).toBe('prov-18-1001');
    expect(shard.edges).toHaveLength(1);
    expect(shard.edges[0]?.relationType).toBe('authority_citation');

    const audit = runAnalyticalCoverageAudit(catalog);
    expect(audit.changesByReleaseAndTitle).toEqual([
      { releaseId: 'rel-119-73', uscTitle: '18', provisionCount: 1 },
    ]);
    expect(audit.missingOrPartialScopes).toHaveLength(1);
    expect(audit.missingOrPartialScopes[0]?.missingPartitions).toEqual(['part-2']);

    // 5. RuleSpec-compatible attributed slice export (USCT-032)
    const sliceRes = exportRuleSpecCompatibleSlice({
      catalog,
      provisionId: 'prov-18-1001',
      releaseId: 'rel-119-73',
      includeAxiomAttribution: true,
    });
    expect(sliceRes.ok).toBe(true);
    if (sliceRes.ok) {
      expect(sliceRes.value.primaryLawLicense).toBe('CC0-1.0');
      expect(sliceRes.value.enrichmentAttribution.some((a) => a.license === 'CC-BY-4.0')).toBe(true);
      expect(sliceRes.value.evidenceSpans).toHaveLength(1);
    }

    // 6. HCK-compatible TaskAttempt receipt export (USCT-031)
    const coordinator = new FencedTaskCoordinator();
    const att = coordinator.startAttempt({
      taskId: 'pilot:title-18',
      attemptId: 'att-hck-1',
      inputIdentity: 'in-1',
      ownerWorkerId: 'worker-1',
      nowMs: 1000,
      leaseDurationMs: 5000,
    });
    coordinator.proposeAcceptance({
      attemptId: att.attemptId,
      outputArtifactHash: '9'.repeat(64),
      nowMs: 2000,
    });
    const hckRes = exportHckTaskAttemptReceipt(coordinator, att.attemptId);
    expect(hckRes.ok).toBe(true);
    if (hckRes.ok) {
      expect(hckRes.value.state).toBe('accepted');
      expect(hckRes.value.acceptedOutputHash).toBe('9'.repeat(64));
    }

    // 7. M5 Pilot Parity & Corrupt-Index Recovery Drill (USCT-026, USCT-027, USCT-028)
    // Compares a 2-step incremental ingestion against a single-pass clean replay AND corrupt-index recovery
    const fullSnap = catalog.getSnapshot();
    const step1Bundle: Partial<CatalogStateSnapshot> = {
      releases: fullSnap.releases,
      provisions: fullSnap.provisions,
      evidenceSpans: fullSnap.evidenceSpans,
    };
    const step2Bundle: Partial<CatalogStateSnapshot> = {
      provisionVersions: fullSnap.provisionVersions,
      memberships: fullSnap.memberships,
      assertions: fullSnap.assertions,
      coverages: fullSnap.coverages,
    };
    const drill = await runPilotParityAndRecoveryDrill({
      catalog,
      publicationId: 'pub-pilot-1',
      workDir: tmpDir,
      incrementalBundles: [step1Bundle, step2Bundle],
    });
    expect(drill.cleanVsIncrementalDigestMatch).toBe(true);
    expect(drill.recoveredFromCorruptIndexMatch).toBe(true);
    expect(drill.shardCount).toBe(1);
  });
});

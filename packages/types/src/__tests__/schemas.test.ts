import { describe, it, expect } from 'vitest';
import {
  ReleasePointSchema,
  CaseAnnotationSchema,
  PrecedentAnnotationSchema,
  PrecedentImpactSchema,
  ImplementingRegulationSchema,
  SectionRegulationsSchema,
  LegislativeHistoryItemSchema,
  SectionLegislativeHistorySchema,
  SourceRefreshMetaSchema,
  resolveRefreshWithFallback,
  isVerifiedCaseProposition,
  isVerifiedRegulationAuthority,
  SourceArtifactSchema,
  SourceSnapshotSchema,
  SourceReleaseSchema,
  EvidenceSpanSchema,
  TemporalBoundarySchema,
  ApplicabilityClaimSchema,
  ProvisionSchema,
  ProvisionVersionSchema,
  SnapshotMembershipSchema,
  CitationAssignmentSchema,
  IdentityTransitionSchema,
  LegalAssertionSchema,
  CollectionCoverageSchema,
  PublicationReceiptSchema,
  ok,
  err,
} from '../index.js';

describe('Result helpers', () => {
  it('ok wraps a value', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it('err wraps an error', () => {
    const result = err(new Error('fail'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('fail');
  });
});

describe('USCT-002: SourceAcquisitionOutcome & resolveRefreshWithFallback', () => {
  it('distinguishes success-empty from success-nonempty when refresh succeeds', () => {
    const emptyOutcome = resolveRefreshWithFallback({
      status: 'success-empty',
      source: 'ecfr',
      scope: '18 U.S.C. 111',
      observedAt: '2026-11-21T12:00:00Z',
      data: [] as string[],
      isEmpty: (arr) => arr.length === 0,
    });
    expect(emptyOutcome.status).toBe('success-empty');
    expect(emptyOutcome.isStale).toBe(false);
    expect(emptyOutcome.retainedPriorSnapshot).toBe(false);
    expect(emptyOutcome.lastSuccessAt).toBe('2026-11-21T12:00:00Z');

    const nonEmptyOutcome = resolveRefreshWithFallback({
      status: 'success-nonempty',
      source: 'ecfr',
      scope: '42 U.S.C. 7401',
      observedAt: '2026-11-21T12:00:00Z',
      data: ['40 CFR Part 50'],
      isEmpty: (arr) => arr.length === 0,
    });
    expect(nonEmptyOutcome.status).toBe('success-nonempty');
    expect(nonEmptyOutcome.data).toEqual(['40 CFR Part 50']);
  });

  it('retains prior snapshot and labels stale when a refresh fails (429/500/network)', () => {
    const prior = {
      data: ['40 CFR Part 50'],
      lastSuccessAt: '2026-10-01T00:00:00Z',
    };
    const failedOutcome = resolveRefreshWithFallback(
      {
        status: 'failed',
        source: 'ecfr',
        scope: '42 U.S.C. 7401',
        observedAt: '2026-11-21T12:00:00Z',
        data: [] as string[],
        isEmpty: (arr) => arr.length === 0,
        httpStatus: 503,
        failureKind: 'http_error',
        errorMessage: 'HTTP 503 Service Unavailable',
      },
      prior
    );

    expect(failedOutcome.status).toBe('failed');
    expect(failedOutcome.retainedPriorSnapshot).toBe(true);
    expect(failedOutcome.isStale).toBe(true);
    expect(failedOutcome.data).toEqual(['40 CFR Part 50']);
    expect(failedOutcome.lastSuccessAt).toBe('2026-10-01T00:00:00Z');
    expect(failedOutcome.httpStatus).toBe(503);
  });

  it('never reports success-empty on failure when no prior snapshot exists', () => {
    const failedOutcome = resolveRefreshWithFallback({
      status: 'failed',
      source: 'courtlistener',
      scope: '18 U.S.C. 111',
      observedAt: '2026-11-21T12:00:00Z',
      data: [] as string[],
      isEmpty: (arr) => arr.length === 0,
      httpStatus: 429,
      failureKind: 'rate_limited',
      errorMessage: 'HTTP 429 Too Many Requests',
    });

    expect(failedOutcome.status).toBe('failed');
    expect(failedOutcome.retainedPriorSnapshot).toBe(false);
    expect(failedOutcome.isStale).toBe(true);
    expect(failedOutcome.failureKind).toBe('rate_limited');
    expect(SourceRefreshMetaSchema.parse(failedOutcome).status).toBe('failed');
  });
});

describe('ReleasePointSchema', () => {
  const valid = {
    title: '18',
    publicLaw: 'PL 119-73',
    dateET: '2026-01-15T12:00:00Z',
    uslmUrl: 'https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_usc18@119-73.zip',
    sha256Hash: 'a'.repeat(64),
  };

  it('accepts a valid release point', () => {
    expect(ReleasePointSchema.parse(valid)).toEqual(valid);
  });

  it('accepts optional releaseSegment with exclusions (e.g., 119/73not60)', () => {
    const withSegment = { ...valid, releaseSegment: '119/73not60' };
    expect(ReleasePointSchema.parse(withSegment).releaseSegment).toBe('119/73not60');
  });

  it('rejects empty title', () => {
    expect(() => ReleasePointSchema.parse({ ...valid, title: '' })).toThrow();
  });

  it('rejects invalid URL', () => {
    expect(() => ReleasePointSchema.parse({ ...valid, uslmUrl: 'not-a-url' })).toThrow();
  });

  it('rejects non-http(s) uslmUrl schemes', () => {
    expect(() => ReleasePointSchema.parse({ ...valid, uslmUrl: 'javascript:alert(1)' })).toThrow();
    expect(() => ReleasePointSchema.parse({ ...valid, uslmUrl: 'ftp://uscode.house.gov/x.zip' })).toThrow();
  });

  it('rejects wrong-length sha256Hash', () => {
    expect(() => ReleasePointSchema.parse({ ...valid, sha256Hash: 'abc' })).toThrow();
  });

  it('rejects invalid dateET format', () => {
    expect(() => ReleasePointSchema.parse({ ...valid, dateET: 'March 15' })).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => ReleasePointSchema.parse({ title: '1' })).toThrow();
  });
});

describe('PrecedentImpactSchema & USCT-004 CaseAnnotationSchema', () => {
  it('accepts valid impacts including unverified_mention', () => {
    for (const impact of ['unverified_mention', 'interpretation', 'unconstitutional', 'narrowed', 'historical']) {
      expect(PrecedentImpactSchema.parse(impact)).toBe(impact);
    }
  });

  it('rejects invalid impact', () => {
    expect(() => PrecedentImpactSchema.parse('overturned')).toThrow();
  });

  const valid = {
    caseName: 'United States v. Smith',
    citation: '500 U.S. 123 (2020)',
    court: 'SCOTUS' as const,
    date: '2020-06-15',
    holdingSummary: 'Held that the statute applies to federal officers.',
    sourceUrl: 'https://courtlistener.com/opinion/12345/',
    impact: 'interpretation' as const,
  };

  it('accepts valid case annotation and distinguishes candidate snippets from verified propositions (USCT-004)', () => {
    const parsed = CaseAnnotationSchema.parse(valid);
    expect(parsed).toEqual(valid);
    expect(isVerifiedCaseProposition(parsed)).toBe(false);

    const candidateHit = CaseAnnotationSchema.parse({
      ...valid,
      retrievalExcerpt: '...mentioning 18 U.S.C. 111 in passing...',
      retrievalQuery: '"18 U.S.C. 111"',
      retrievedAt: '2026-11-21T12:00:00Z',
      extractionState: 'candidate',
      editorialReview: 'unreviewed',
      impact: 'unverified_mention',
    });
    expect(isVerifiedCaseProposition(candidateHit)).toBe(false);

    const verifiedCase = CaseAnnotationSchema.parse({
      ...valid,
      extractionState: 'verified',
      editorialReview: 'accepted',
      reviewedProposition: 'Forcible assault under 18 U.S.C. 111(a) does not require physical contact.',
      supportingOpinionPassage: 'We hold that physical contact is not an element of forcible assault under § 111(a).',
      versionAlignmentState: 'verified',
      statuteVersionRef: 'PL 116-220',
    });
    expect(isVerifiedCaseProposition(verifiedCase)).toBe(true);
  });

  it('accepts optional statuteVersionRef', () => {
    const withRef = { ...valid, statuteVersionRef: 'PL 117-81', statuteVersionNote: 'Current at time of decision' };
    expect(CaseAnnotationSchema.parse(withRef)).toEqual(withRef);
  });

  it('rejects invalid court', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, court: 'State' })).toThrow();
  });

  it('rejects a javascript: sourceUrl (would render as an href)', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, sourceUrl: 'javascript:alert(document.cookie)' })).toThrow();
  });

  it('accepts an empty string sourceUrl (fallback for unpinned or missing source URLs)', () => {
    const withEmpty = { ...valid, sourceUrl: '' };
    expect(CaseAnnotationSchema.parse(withEmpty).sourceUrl).toBe('');
  });

  it('rejects holdingSummary over 500 chars', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, holdingSummary: 'x'.repeat(501) })).toThrow();
  });

  it('accepts holdingSummary at exactly 500 chars', () => {
    const atLimit = { ...valid, holdingSummary: 'x'.repeat(500) };
    expect(CaseAnnotationSchema.parse(atLimit).holdingSummary).toHaveLength(500);
  });

  it('rejects caseName over 500 chars but accepts it at the cap', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, caseName: 'x'.repeat(501) })).toThrow();
    expect(CaseAnnotationSchema.parse({ ...valid, caseName: 'x'.repeat(500) }).caseName).toHaveLength(500);
  });

  it('rejects citation over 200 chars but accepts it at the cap', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, citation: 'x'.repeat(201) })).toThrow();
    expect(CaseAnnotationSchema.parse({ ...valid, citation: 'x'.repeat(200) }).citation).toHaveLength(200);
  });

  it('rejects statuteVersionRef over 100 chars', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, statuteVersionRef: 'x'.repeat(101) })).toThrow();
  });

  it('rejects statuteVersionNote over 500 chars', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, statuteVersionNote: 'x'.repeat(501) })).toThrow();
  });
});

describe('PrecedentAnnotationSchema', () => {
  it('accepts valid annotation with cases', () => {
    const annotation = {
      targetSection: '18 U.S.C. § 111',
      lastSyncedET: '2026-03-29T18:00:00Z',
      cases: [{
        caseName: 'United States v. Doe',
        citation: '600 U.S. 1 (2025)',
        court: 'SCOTUS' as const,
        date: '2025-01-01',
        holdingSummary: 'Test holding',
        sourceUrl: 'https://example.com/case',
        impact: 'interpretation' as const,
      }],
    };
    const result = PrecedentAnnotationSchema.parse(annotation);
    expect(result.cases).toHaveLength(1);
    expect(result.targetSection).toBe('18 U.S.C. § 111');
  });

  it('accepts empty cases array', () => {
    const annotation = {
      targetSection: '26 U.S.C. § 1',
      lastSyncedET: '2026-01-01T00:00:00Z',
      cases: [],
    };
    expect(PrecedentAnnotationSchema.parse(annotation).cases).toHaveLength(0);
  });

  it('rejects invalid lastSyncedET', () => {
    expect(() => PrecedentAnnotationSchema.parse({
      targetSection: 'test',
      lastSyncedET: 'not-a-date',
      cases: [],
    })).toThrow();
  });
});

describe('USCT-003: ImplementingRegulationSchema & SectionRegulationsSchema', () => {
  const validReg = {
    cfrTitle: 40,
    cfrPart: 50,
    agency: 'Environmental Protection Agency',
    description: 'National Primary and Secondary Ambient Air Quality Standards',
    ecfrUrl: 'https://www.ecfr.gov/current/title-40/part-50',
  };

  it('defaults eCFR entries to unverified text-match candidates unless authority is verified (USCT-003)', () => {
    const parsed = ImplementingRegulationSchema.parse(validReg);
    expect(parsed.extractionState).toBe('candidate');
    expect(parsed.editorialReview).toBe('unreviewed');
    expect(parsed.relationshipType).toBe('text_match_candidate');
    expect(isVerifiedRegulationAuthority(parsed)).toBe(false);

    const verified = ImplementingRegulationSchema.parse({
      ...validReg,
      extractionState: 'verified',
      editorialReview: 'accepted',
      relationshipType: 'authority_citation',
      verifiedAuthorityText: 'Authority: 42 U.S.C. 7401 et seq.',
    });
    expect(isVerifiedRegulationAuthority(verified)).toBe(true);
  });

  it('rejects invalid ecfrUrl scheme', () => {
    expect(() => ImplementingRegulationSchema.parse({ ...validReg, ecfrUrl: 'javascript:alert(1)' })).toThrow();
  });

  it('accepts valid section regulations container', () => {
    const container = {
      targetSection: '42-7401',
      lastUpdated: '2026-03-30T00:00:00Z',
      regulations: [validReg],
    };
    const parsed = SectionRegulationsSchema.parse(container);
    expect(parsed.targetSection).toBe('42-7401');
    expect(parsed.regulations[0]?.extractionState).toBe('candidate');
  });
});

describe('LegislativeHistoryItemSchema & SectionLegislativeHistorySchema', () => {
  const validHistory = {
    publicLaw: 'PL 104-132',
    congress: 104,
    billNumber: 'S. 735',
    enactedDate: '1996-04-24',
    crsSummary: 'Antiterrorism and Effective Death Penalty Act of 1996.',
    statutesAtLargeCitation: '110 Stat. 1214',
    statutesAtLargeUrl: 'https://www.govinfo.gov/link/statute/110/1214',
    committeeReports: [
      {
        reportNumber: 'H. Rept. 104-518',
        chamber: 'Conference' as const,
        url: 'https://www.govinfo.gov/content/pkg/CRPT-104hrpt518/pdf/CRPT-104hrpt518.pdf',
      },
    ],
  };

  it('accepts valid legislative history item', () => {
    expect(LegislativeHistoryItemSchema.parse(validHistory)).toEqual(validHistory);
  });

  it('accepts valid section legislative history container', () => {
    const container = {
      targetSection: '18-2332b',
      lastUpdated: '2026-03-30T00:00:00Z',
      history: [validHistory],
    };
    expect(SectionLegislativeHistorySchema.parse(container)).toEqual(container);
  });
});

describe('Canonical Data Contracts (M1–M5 schemas)', () => {
  const hex64 = 'a0b1c2d3e4f50123456789abcdefa0b1c2d3e4f50123456789abcdef01234567';

  it('validates SourceArtifact, SourceSnapshot, SourceRelease, and EvidenceSpan', () => {
    const artifact = SourceArtifactSchema.parse({
      artifactId: 'art-1',
      sha256: hex64,
      byteLength: 1024,
      mediaType: 'application/xml',
      storageLocator: 'artifacts/sha256/' + hex64,
    });
    expect(artifact.license).toBe('unknown');

    const cc0Artifact = SourceArtifactSchema.parse({
      artifactId: 'art-cc0',
      sha256: hex64,
      byteLength: 512,
      mediaType: 'application/xml',
      storageLocator: 'artifacts/sha256/' + hex64,
      license: 'CC0-1.0',
    });
    expect(cc0Artifact.license).toBe('CC0-1.0');

    const snapshot = SourceSnapshotSchema.parse({
      snapshotId: 'snap-1',
      sourceRegistryId: 'olrc-uslm',
      requestedUrl: 'https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_usc18@119-73.zip',
      finalUrl: 'https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_usc18@119-73.zip',
      publisher: 'OLRC',
      authorityKind: 'statute',
      artifactId: artifact.artifactId,
      retrievedAt: '2026-11-21T12:00:00Z',
      publishedDate: '2026-01-23',
      publishedDatePrecision: 'day',
    });
    expect(snapshot.legacyDerived).toBe(false);

    const release = SourceReleaseSchema.parse({
      releaseId: 'rel-pl-119-73not60',
      publisherReleaseLabel: 'PL 119-73 (excluding 119-60)',
      releaseSegment: '119/73not60',
      congress: 119,
      lawIdentifier: '73not60',
      exclusions: ['119-60'],
      snapshotIds: [snapshot.snapshotId],
      coverageId: 'cov-1',
      manifestDigest: hex64,
      observedAt: '2026-11-21T12:00:00Z',
    });
    expect(release.exclusions).toEqual(['119-60']);

    const span = EvidenceSpanSchema.parse({
      evidenceId: 'ev-1',
      sourceSnapshotId: snapshot.snapshotId,
      artifactSha256: hex64,
      locatorKind: 'uslm_id',
      locatorValue: '/us/usc/t18/s111/a',
      excerpt: 'Whoever forcibly assaults, resists, opposes, impedes, intimidates, or interferes with...',
      excerptSha256: hex64,
      extractorVersion: '1.0.0',
    });
    expect(span.locatorKind).toBe('uslm_id');
  });

  it('validates TemporalBoundary and ApplicabilityClaim without fabricating dates', () => {
    const start = TemporalBoundarySchema.parse({
      state: 'known',
      value: '2027-01-01',
      precision: 'day',
      inclusive: true,
      originalWording: 'effective January 1, 2027',
      basis: 'explicit_effective_date_clause',
      evidenceIds: ['ev-1'],
    });
    const end = TemporalBoundarySchema.parse({
      state: 'unknown',
      precision: 'unknown',
      basis: 'unestablished',
    });

    const claim = ApplicabilityClaimSchema.parse({
      claimId: 'claim-1',
      targetProvisionVersionId: 'pv-1',
      targetSubdivisionLocator: 'subsection (b)',
      applicabilityState: 'conditional',
      startBoundary: start,
      endBoundary: end,
      requiredContextFacts: ['tax_year_begins_after_2025_12_31'],
      sourceLanguage: 'Applies to taxable years beginning after December 31, 2025.',
    });
    expect(claim.applicabilityState).toBe('conditional');
    expect(claim.endBoundary.value).toBeUndefined();
  });

  it('validates Provision, ProvisionVersion, SnapshotMembership, CitationAssignment, IdentityTransition, LegalAssertion, CollectionCoverage, and PublicationReceipt', () => {
    expect(ProvisionSchema.parse({
      provisionId: 'prov-usc-18-111',
      documentKind: 'usc_section',
      creationBasis: 'USLM /us/usc/t18/s111',
    }).provisionId).toBe('prov-usc-18-111');

    expect(ProvisionVersionSchema.parse({
      provisionVersionId: 'pv-1',
      provisionId: 'prov-usc-18-111',
      normalizedContentHash: hex64,
      normalizationVersion: '1.0.0',
      uscTitle: '18',
      uscChapter: '7',
      uscSection: '111',
      heading: 'Assaulting, resisting, or impeding certain officers or employees',
      status: 'active',
      bodyMarkdown: '# (a) In general',
    }).status).toBe('active');

    expect(SnapshotMembershipSchema.parse({
      membershipId: 'mem-1',
      sourceReleaseId: 'rel-1',
      provisionVersionId: 'pv-1',
      provisionId: 'prov-usc-18-111',
      sourceOrder: 1,
      hierarchyPath: 'title-18/chapter-7/section-111',
      sourceLocator: '/us/usc/t18/s111',
    }).sourceOrder).toBe(1);

    expect(CitationAssignmentSchema.parse({
      assignmentId: 'ca-1',
      provisionId: 'prov-usc-18-111',
      normalizedCitation: '18 U.S.C. 111',
      legacySlug: 'title-18/chapter-7/section-111',
      releaseIds: ['rel-1'],
    }).normalizedCitation).toBe('18 U.S.C. 111');

    expect(IdentityTransitionSchema.parse({
      transitionId: 'tr-1',
      transitionKind: 'transferred_to',
      fromProvisionId: 'prov-A',
      fromCitation: '42 U.S.C. 405a',
      toProvisionIds: ['prov-B'],
      toCitations: ['42 U.S.C. 405b'],
      extractionState: 'verified',
      editorialReview: 'accepted',
    }).transitionKind).toBe('transferred_to');

    expect(LegalAssertionSchema.parse({
      assertionId: 'as-1',
      subjectId: 'cfr-40-50',
      relationType: 'authority_citation',
      objectId: 'prov-usc-42-7401',
      authorityKind: 'regulation',
      extractionMethod: 'ecfr_authority_parser',
      extractorVersion: '1.0.0',
      extractionState: 'verified',
      editorialReview: 'accepted',
    }).relationType).toBe('authority_citation');

    expect(CollectionCoverageSchema.parse({
      coverageId: 'cov-1',
      sourceScope: 'olrc:pl-119-73',
      sourceFamily: 'olrc_uslm',
      expectedPartitions: ['01', '18'],
      completedPartitions: ['01', '18'],
      coverageState: 'complete',
      lastAttemptedAt: '2026-11-21T12:00:00Z',
    }).coverageState).toBe('complete');

    const sha40 = '8c0b1974c0d1df151739a4a054205e6bb77d6a36';
    expect(PublicationReceiptSchema.parse({
      publicationId: 'pub-1',
      acceptedDataCommitSha: sha40,
      acceptedDataTag: 'pl-119-73',
      trackerSubmodulePinSha: sha40,
      trackerBuildCommitSha: '822d2a5f904a874f107bcdf4c99f0e1fda4f5d51',
      promotedAt: '2026-11-21T12:00:00Z',
      validationPassed: true,
      requiredScopesComplete: true,
      manifestDigest: hex64,
    }).validationPassed).toBe(true);
  });
});

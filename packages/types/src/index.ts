import { z } from 'zod';
export * from './ecfr-bulk.js';
export * from './navigation.js';

// --- Result type ---

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// --- Shared field schemas ---

/**
 * A URL constrained to the http(s) scheme. Plain `z.url()` accepts dangerous
 * schemes such as `javascript:` and `data:`; several of these values are later
 * rendered as `href`s or used to download content, so we reject anything that
 * is not http/https at the validation boundary.
 */
export const HttpUrlSchema = z
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: 'URL must use the http(s) scheme' });

/**
 * A URL constrained to the http(s) scheme or an empty string. Used for external
 * source URLs that collapse to empty string when failing origin validation without
 * rejecting the entire annotation record.
 */
export const OptionalHttpUrlSchema = z
  .string()
  .refine((u) => u === '' || /^https?:\/\//i.test(u), { message: 'URL must use the http(s) scheme or be empty' });

/** Strict lowercase 64-character hexadecimal SHA-256 digest */
export const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, { message: 'Must be a valid 64-character hex SHA-256 digest' });

// --- Five Orthogonal Trust & Coverage Dimensions (DATA-CONTRACTS.md §1) ---

/** Extraction state: whether the source supports the extracted text or relationship */
export const ExtractionStateSchema = z.enum(['candidate', 'verified', 'rejected']);
export type ExtractionState = z.infer<typeof ExtractionStateSchema>;

/** Editorial review state: separate from automated extraction and model confidence */
export const EditorialReviewStateSchema = z.enum(['unreviewed', 'accepted', 'disputed', 'superseded']);
export type EditorialReviewState = z.infer<typeof EditorialReviewStateSchema>;

/** Legal authority of the source document */
export const LegalAuthorityKindSchema = z.enum([
  'statute',
  'regulation',
  'judicial_opinion',
  'agency_guidance',
  'editorial_material',
  'third_party_interpretation',
]);
export type LegalAuthorityKind = z.infer<typeof LegalAuthorityKindSchema>;

/** Legal applicability determination state */
export const ApplicabilityStateSchema = z.enum(['known', 'conditional', 'disputed', 'unknown']);
export type ApplicabilityState = z.infer<typeof ApplicabilityStateSchema>;

/** Collection coverage relative to a declared source scope */
export const CollectionCoverageStateSchema = z.enum([
  'complete',
  'partial',
  'failed',
  'not_collected',
]);
export type CollectionCoverageState = z.infer<typeof CollectionCoverageStateSchema>;

// --- USCT-002: Source Acquisition & Refresh Outcome Contract ---

export const SourceOutcomeStatusSchema = z.enum([
  'success-empty',
  'success-nonempty',
  'partial',
  'failed',
  'absent',
  'not_collected',
]);
export type SourceOutcomeStatus = z.infer<typeof SourceOutcomeStatusSchema>;

export const SourceFetchFailureKindSchema = z.enum([
  'rate_limited',
  'http_error',
  'timeout',
  'network_error',
  'malformed_payload',
  'pagination_incomplete',
  'fidelity_failed',
]);
export type SourceFetchFailureKind = z.infer<typeof SourceFetchFailureKindSchema>;

export const SourceRefreshMetaSchema = z.object({
  source: z.string().min(1),
  scope: z.string().min(1),
  status: SourceOutcomeStatusSchema,
  observedAt: z.string().datetime(),
  lastSuccessAt: z.string().datetime().optional(),
  retainedPriorSnapshot: z.boolean().default(false),
  isStale: z.boolean().default(false),
  httpStatus: z.number().int().optional(),
  failureKind: SourceFetchFailureKindSchema.optional(),
  errorMessage: z.string().max(1000).optional(),
  completedPages: z.number().int().nonnegative().optional(),
  expectedPages: z.number().int().nonnegative().optional(),
});
export type SourceRefreshMeta = z.infer<typeof SourceRefreshMetaSchema>;

/** Generic typed outcome for source acquisition & refresh (USCT-002) */
export interface SourceAcquisitionOutcome<T> {
  status: SourceOutcomeStatus;
  source: string;
  scope: string;
  observedAt: string;
  lastSuccessAt?: string | undefined;
  data: T;
  retainedPriorSnapshot: boolean;
  isStale: boolean;
  httpStatus?: number | undefined;
  failureKind?: SourceFetchFailureKind | undefined;
  errorMessage?: string | undefined;
  completedPages?: number | undefined;
  expectedPages?: number | undefined;
}

/**
 * Resolve a refresh outcome against an optional prior valid snapshot (USCT-002).
 * When a refresh fails or is partial and a prior snapshot exists, retains the prior
 * snapshot and marks it stale instead of reporting a false empty result.
 */
export function resolveRefreshWithFallback<T>(
  attempt: {
    status: SourceOutcomeStatus;
    source: string;
    scope: string;
    observedAt: string;
    data: T;
    isEmpty: (val: T) => boolean;
    httpStatus?: number | undefined;
    failureKind?: SourceFetchFailureKind | undefined;
    errorMessage?: string | undefined;
    completedPages?: number | undefined;
    expectedPages?: number | undefined;
  },
  priorSnapshot?: { data: T; lastSuccessAt: string } | null
): SourceAcquisitionOutcome<T> {
  const isHealthy = attempt.status === 'success-empty' || attempt.status === 'success-nonempty';
  if (isHealthy) {
    return {
      status: attempt.isEmpty(attempt.data) ? 'success-empty' : 'success-nonempty',
      source: attempt.source,
      scope: attempt.scope,
      observedAt: attempt.observedAt,
      lastSuccessAt: attempt.observedAt,
      data: attempt.data,
      retainedPriorSnapshot: false,
      isStale: false,
      completedPages: attempt.completedPages,
      expectedPages: attempt.expectedPages,
    };
  }

  // On failure or partial result with empty data, retain prior snapshot if available
  const usePrior = priorSnapshot !== undefined && priorSnapshot !== null && (
    attempt.status === 'failed' || attempt.isEmpty(attempt.data)
  );

  return {
    status: attempt.status,
    source: attempt.source,
    scope: attempt.scope,
    observedAt: attempt.observedAt,
    lastSuccessAt: priorSnapshot?.lastSuccessAt,
    data: usePrior ? priorSnapshot.data : attempt.data,
    retainedPriorSnapshot: usePrior,
    isStale: usePrior || attempt.status === 'partial' || attempt.status === 'failed',
    httpStatus: attempt.httpStatus,
    failureKind: attempt.failureKind,
    errorMessage: attempt.errorMessage,
    completedPages: attempt.completedPages,
    expectedPages: attempt.expectedPages,
  };
}

// --- Release Point schema ---

export const ReleasePointSchema = z.object({
  /** Title number (e.g., "26" for Internal Revenue Code, "5a" for Title 5 Appendix) */
  title: z.string().min(1),
  /** Public law reference (e.g., "PL 118-200") */
  publicLaw: z.string(),
  /** Full lossless OLRC release segment including exclusions/corrections (e.g., "119/73not60") */
  releaseSegment: z.string().min(1).optional(),
  /** Release date in ISO 8601 datetime format (ET timezone) */
  dateET: z.string().datetime(),
  /** URL to the USLM XML download for this release */
  uslmUrl: HttpUrlSchema,
  /** SHA-256 hex digest for integrity verification (64 hex characters) */
  sha256Hash: z.string().length(64),
});

export type ReleasePoint = z.infer<typeof ReleasePointSchema>;

// --- Precedent Annotation schema (USCT-004 & USCT-015) ---

/**
 * Impact / proposition classification for how a case relates to the statute.
 * Search hits default to 'unverified_mention' until opinion evidence is verified.
 * Legacy values ('interpretation', 'unconstitutional', 'narrowed', 'historical')
 * remain valid for backward compatibility.
 */
export const PrecedentImpactSchema = z.enum([
  'unverified_mention',
  'interpretation',
  'unconstitutional',
  'narrowed',
  'historical',
]);

export type PrecedentImpact = z.infer<typeof PrecedentImpactSchema>;

export const StatuteVersionAlignmentStateSchema = z.enum([
  'verified',
  'candidate',
  'ambiguous',
  'unknown',
]);
export type StatuteVersionAlignmentState = z.infer<typeof StatuteVersionAlignmentStateSchema>;

export const CaseAnnotationSchema = z.object({
  caseName: z.string().max(500),
  citation: z.string().max(200),
  court: z.enum(['SCOTUS', 'Appellate', 'District']),
  date: z.string(),
  /**
   * Legacy field retained for compatibility with existing sidecars.
   * For unreviewed CourtListener search hits, represents a retrieval snippet,
   * never an authoritative judicial holding (USCT-004).
   */
  holdingSummary: z.string().max(500),
  /** Explicit retrieval excerpt from search API (USCT-004) */
  retrievalExcerpt: z.string().max(500).optional(),
  /** Reviewed legal proposition, populated only when extractionState === 'verified' and editorialReview === 'accepted' (USCT-004 / USCT-015) */
  reviewedProposition: z.string().max(1000).optional(),
  /** Exact supporting passage from the full opinion text (USCT-015) */
  supportingOpinionPassage: z.string().max(2000).optional(),
  /** Search query used to retrieve this candidate */
  retrievalQuery: z.string().max(200).optional(),
  /** Timestamp when this search candidate or opinion was retrieved */
  retrievedAt: z.string().datetime().optional(),
  /** Extraction state: 'candidate' for search snippets, 'verified' for opinion-checked citations */
  extractionState: ExtractionStateSchema.optional(),
  /** Editorial review state: 'unreviewed' for automated search hits, 'accepted' for reviewed holdings */
  editorialReview: EditorialReviewStateSchema.optional(),
  /** Version alignment confidence between opinion and statute text (USCT-015) */
  versionAlignmentState: StatuteVersionAlignmentStateSchema.optional(),
  sourceUrl: OptionalHttpUrlSchema,
  impact: PrecedentImpactSchema,
  /** Public Law the statute was current through when this case was decided */
  statuteVersionRef: z.string().max(100).optional(),
  /** Human-readable note about version alignment */
  statuteVersionNote: z.string().max(500).optional(),
});

export type CaseAnnotationItem = z.infer<typeof CaseAnnotationSchema>;

/**
 * Determine whether a CaseAnnotation carries a verified, reviewed legal holding/proposition,
 * as opposed to an unreviewed search retrieval snippet (USCT-004).
 */
export function isVerifiedCaseProposition(c: {
  extractionState?: ExtractionState | undefined;
  editorialReview?: EditorialReviewState | undefined;
  reviewedProposition?: string | undefined;
}): boolean {
  return (
    c.extractionState === 'verified' &&
    c.editorialReview === 'accepted' &&
    typeof c.reviewedProposition === 'string' &&
    c.reviewedProposition.trim().length > 0
  );
}

export const PrecedentAnnotationSchema = z.object({
  targetSection: z.string(),
  lastSyncedET: z.string().datetime(),
  totalCases: z.number().int().nonnegative().optional(),
  refreshStatus: SourceRefreshMetaSchema.optional(),
  cases: z.array(CaseAnnotationSchema),
});

export type PrecedentAnnotation = z.infer<typeof PrecedentAnnotationSchema>;

// --- Implementing Regulations & Candidates (USCT-003 & USCT-014) ---

export const RegulationRelationshipTypeSchema = z.enum([
  'text_match_candidate',
  'cites',
  'authority_citation',
  'implements_verified',
]);
export type RegulationRelationshipType = z.infer<typeof RegulationRelationshipTypeSchema>;

export const ImplementingRegulationSchema = z.object({
  /** CFR Title number */
  cfrTitle: z.number().int().positive(),
  /** CFR Part number */
  cfrPart: z.number().int().positive(),
  /** Agency name (e.g. "Environmental Protection Agency") */
  agency: z.string().max(300),
  /** Subject description */
  description: z.string().max(500).optional(),
  /** Authoritative eCFR URL */
  ecfrUrl: HttpUrlSchema,
  /** Extraction state: 'candidate' for full-text search hits, 'verified' for checked PTOA/authority citations (USCT-003) */
  extractionState: ExtractionStateSchema.default('candidate'),
  /** Editorial review state */
  editorialReview: EditorialReviewStateSchema.default('unreviewed'),
  /** Relationship type: defaults to 'text_match_candidate' for eCFR search hits */
  relationshipType: RegulationRelationshipTypeSchema.default('text_match_candidate'),
  /** Search query or PTOA key used to discover this entry */
  discoveryQuery: z.string().max(200).optional(),
  /** Exact matching snippet or authority citation text (USCT-003 / USCT-014) */
  matchingEvidence: z.string().max(1000).optional(),
  /** Verbatim authority note from the CFR part when verified (USCT-014) */
  verifiedAuthorityText: z.string().max(1000).optional(),
  /** Timestamp when this candidate/authority was retrieved */
  retrievedAt: z.string().datetime().optional(),
});

export type ImplementingRegulation = z.infer<typeof ImplementingRegulationSchema>;

/**
 * True only when a regulation entry has been verified against official authority evidence (USCT-003 / USCT-014).
 */
export function isVerifiedRegulationAuthority(reg: {
  extractionState?: ExtractionState | undefined;
  relationshipType?: RegulationRelationshipType | undefined;
  verifiedAuthorityText?: string | undefined;
}): boolean {
  return (
    reg.extractionState === 'verified' &&
    (reg.relationshipType === 'authority_citation' || reg.relationshipType === 'implements_verified') &&
    typeof reg.verifiedAuthorityText === 'string' &&
    reg.verifiedAuthorityText.trim().length > 0
  );
}

export const SectionRegulationsSchema = z.object({
  targetSection: z.string(), // e.g. "18-111"
  lastUpdated: z.string().datetime(),
  refreshStatus: SourceRefreshMetaSchema.optional(),
  regulations: z.array(ImplementingRegulationSchema),
});

export type SectionRegulations = z.infer<typeof SectionRegulationsSchema>;

// --- Legislative History (Congress.gov / GovInfo) schema (USCT-013) ---

export const LegislativeHistoryItemSchema = z.object({
  /** Public Law identifier, e.g. "PL 104-132" */
  publicLaw: z.string().max(100),
  congress: z.number().int().positive(),
  billNumber: z.string().max(50).optional(),
  enactedDate: z.string().optional(),
  /** Effective date or condition language if distinct from enactedDate (USCT-013 / USCT-034) */
  effectiveDateNote: z.string().max(1000).optional(),
  applicabilityState: ApplicabilityStateSchema.optional(),
  /** Non-partisan CRS summary of the enacted measure (distinct from enacted text) */
  crsSummary: z.string().max(3000).optional(),
  /** Verbatim enacted amendment language or statutory excerpt (USCT-013) */
  enactedTextExcerpt: z.string().max(3000).optional(),
  /** Source credit text from USLM XML */
  sourceCreditText: z.string().max(1000).optional(),
  extractionState: ExtractionStateSchema.optional(),
  editorialReview: EditorialReviewStateSchema.optional(),
  statutesAtLargeCitation: z.string().max(100).optional(), // e.g. "110 Stat. 1302"
  statutesAtLargeUrl: OptionalHttpUrlSchema.optional(),
  committeeReports: z.array(z.object({
    reportNumber: z.string().max(100),
    chamber: z.enum(['House', 'Senate', 'Conference']),
    url: OptionalHttpUrlSchema,
  })).default([]),
});

export type LegislativeHistoryItem = z.infer<typeof LegislativeHistoryItemSchema>;

export const SectionLegislativeHistorySchema = z.object({
  targetSection: z.string(),
  lastUpdated: z.string().datetime(),
  refreshStatus: SourceRefreshMetaSchema.optional(),
  history: z.array(LegislativeHistoryItemSchema),
});

export type SectionLegislativeHistory = z.infer<typeof SectionLegislativeHistorySchema>;

// --- Canonical Legal & Provenance Contracts (DATA-CONTRACTS.md §2–§10, M1–M5) ---

/** SourceArtifact: immutable original or derived bytes identified by a SHA-256 digest */
export const SourceArtifactSchema = z.object({
  schemaVersion: z.literal('usct.source-artifact/v1').default('usct.source-artifact/v1'),
  artifactId: z.string().min(1),
  sha256: Sha256HexSchema,
  byteLength: z.number().int().nonnegative(),
  mediaType: z.string().min(1),
  storageLocator: z.string().min(1),
  parentArchiveArtifactId: z.string().optional(),
  license: z.string().default('unknown'),
  attributionRequired: z.boolean().default(false),
  attributionText: z.string().optional(),
});
export type SourceArtifact = z.infer<typeof SourceArtifactSchema>;

/** SourceSnapshot: a recorded acquisition of a source document and its provenance */
export const SourceSnapshotSchema = z.object({
  schemaVersion: z.literal('usct.source-snapshot/v1').default('usct.source-snapshot/v1'),
  snapshotId: z.string().min(1),
  sourceRegistryId: z.string().min(1),
  requestedUrl: HttpUrlSchema,
  finalUrl: HttpUrlSchema,
  publisher: z.string().min(1),
  authorityKind: LegalAuthorityKindSchema,
  artifactId: z.string().min(1),
  retrievedAt: z.string().datetime(),
  publisherReleaseLabel: z.string().optional(),
  publishedDate: z.string().optional(),
  publishedDatePrecision: z.enum(['day', 'month', 'year', 'unknown']).default('unknown'),
  discoveredVia: z.string().optional(),
  legacyDerived: z.boolean().default(false),
});
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;

/** SourceRelease: immutable manifest describing a publisher edition or bounded collection */
export const SourceReleaseSchema = z.object({
  schemaVersion: z.literal('usct.source-release/v1').default('usct.source-release/v1'),
  releaseId: z.string().min(1),
  publisherReleaseLabel: z.string().min(1),
  releaseSegment: z.string().min(1),
  congress: z.number().int().positive(),
  lawIdentifier: z.string().min(1),
  exclusions: z.array(z.string()).default([]),
  revisionNumber: z.number().int().positive().default(1),
  supersedesReleaseId: z.string().optional(),
  snapshotIds: z.array(z.string()),
  coverageId: z.string().min(1),
  manifestDigest: Sha256HexSchema,
  gitTag: z.string().optional(),
  gitCommitSha: z.string().optional(),
  publishedDate: z.string().optional(),
  observedAt: z.string().datetime(),
  legacyDerived: z.boolean().default(false),
});
export type SourceRelease = z.infer<typeof SourceReleaseSchema>;

/** EvidenceSpan: precisely located excerpt or value in an immutable source representation */
export const EvidenceSpanSchema = z.object({
  schemaVersion: z.literal('usct.evidence-span/v1').default('usct.evidence-span/v1'),
  evidenceId: z.string().min(1),
  sourceSnapshotId: z.string().min(1),
  artifactSha256: Sha256HexSchema,
  locatorKind: z.enum(['uslm_id', 'xml_path', 'char_offset', 'line_range', 'json_pointer']),
  locatorValue: z.string().min(1),
  excerpt: z.string().max(4000),
  excerptSha256: Sha256HexSchema,
  extractorVersion: z.string().min(1),
});
export type EvidenceSpan = z.infer<typeof EvidenceSpanSchema>;

/** TemporalBoundary: explicit start/end boundary with state, precision, basis, and evidence (USCT-034) */
export const TemporalBoundaryStateSchema = z.enum(['known', 'open', 'unknown', 'conditional']);
export type TemporalBoundaryState = z.infer<typeof TemporalBoundaryStateSchema>;

export const DatePrecisionSchema = z.enum(['day', 'month', 'year', 'unknown']);
export type DatePrecision = z.infer<typeof DatePrecisionSchema>;

export const TemporalBoundarySchema = z.object({
  state: TemporalBoundaryStateSchema,
  value: z.string().optional(), // ISO date YYYY-MM-DD, YYYY-MM, or YYYY; never fabricated midnight UTC
  precision: DatePrecisionSchema.default('unknown'),
  inclusive: z.boolean().optional(),
  originalWording: z.string().max(1000).optional(),
  conditions: z.array(z.string()).default([]),
  basis: z.enum([
    'explicit_effective_date_clause',
    'default_enactment_date',
    'retroactive_clause',
    'sunset_expiration_clause',
    'repeal_clause',
    'conditional_trigger',
    'unestablished',
  ]).default('unestablished'),
  evidenceIds: z.array(z.string()).default([]),
}).superRefine((val, ctx) => {
  if (val.state === 'known') {
    if (!val.value || val.value.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TemporalBoundary with state "known" requires a non-empty value',
        path: ['value'],
      });
    }
    if (val.precision === 'unknown') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TemporalBoundary with state "known" requires explicit date precision',
        path: ['precision'],
      });
    }
    if (val.basis === 'unestablished') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TemporalBoundary with state "known" requires an established legal basis',
        path: ['basis'],
      });
    }
  }
});
export type TemporalBoundary = z.infer<typeof TemporalBoundarySchema>;

/** ApplicabilityClaim: supported, conditional, disputed, or unknown temporal applicability (USCT-034) */
export const ApplicabilityClaimSchema = z.object({
  schemaVersion: z.literal('usct.applicability-claim/v1').default('usct.applicability-claim/v1'),
  claimId: z.string().min(1),
  targetProvisionVersionId: z.string().min(1),
  targetSubdivisionLocator: z.string().optional(), // e.g., "subsection (a)" vs "subsection (b)"
  applicabilityState: ApplicabilityStateSchema,
  startBoundary: TemporalBoundarySchema,
  endBoundary: TemporalBoundarySchema,
  requiredContextFacts: z.array(z.string()).default([]),
  sourceLanguage: z.string().max(2000).optional(),
  evidenceIds: z.array(z.string()).default([]),
  editorialReview: EditorialReviewStateSchema.default('unreviewed'),
  competingClaimIds: z.array(z.string()).default([]),
  supersedesClaimId: z.string().optional(),
});
export type ApplicabilityClaim = z.infer<typeof ApplicabilityClaimSchema>;

/** Provision & ProvisionVersion (DATA-CONTRACTS.md §3, USCT-008 / USCT-010 / USCT-011) */
export const ProvisionSchema = z.object({
  schemaVersion: z.literal('usct.provision/v1').default('usct.provision/v1'),
  provisionId: z.string().min(1),
  jurisdiction: z.literal('US').default('US'),
  documentKind: z.enum(['usc_section', 'cfr_part', 'public_law_section', 'judicial_opinion', 'agency_guidance']),
  creationBasis: z.string().min(1),
  identityRegistryVersion: z.number().int().positive().default(1),
});
export type Provision = z.infer<typeof ProvisionSchema>;

export const StructuredNoteSchema = z.object({
  noteId: z.string().min(1),
  topic: z.string().optional(),
  role: z.enum(['amendment', 'effective_date', 'transfer', 'repeal', 'codification', 'cross_reference', 'general']).default('general'),
  heading: z.string().optional(),
  text: z.string(),
  locator: z.string(),
});
export type StructuredNote = z.infer<typeof StructuredNoteSchema>;

export const StructuredTableSchema = z.object({
  tableId: z.string().min(1),
  caption: z.string().optional(),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  locator: z.string(),
});
export type StructuredTable = z.infer<typeof StructuredTableSchema>;

export const HistoricalSourceQualificationSchema = z.object({
  schemaVersion: z.literal('usct.historical-source-qualification/v1'),
  releaseId: z.string().regex(/^pl-[0-9]+-[0-9]+$/),
  archiveSha256: Sha256HexSchema,
  memberName: z.literal('usc18.xml'),
  memberSha256: Sha256HexSchema,
  sectionIdentifier: z.string().regex(/^\/us\/usc\/t18\/s[0-9]+[a-z]*$/),
  recipeSha256: Sha256HexSchema,
  markdownSha256: Sha256HexSchema,
  htmlSha256: Sha256HexSchema,
  witnessSha256: Sha256HexSchema,
  scope: z.literal('text-lanes-and-list-placement-v1'),
});
export type HistoricalSourceQualification = z.infer<typeof HistoricalSourceQualificationSchema>;

export const ProvisionVersionSchema = z.object({
  schemaVersion: z.literal('usct.provision-version/v1').default('usct.provision-version/v1'),
  provisionVersionId: z.string().min(1),
  provisionId: z.string().min(1),
  normalizedContentHash: Sha256HexSchema,
  normalizationVersion: z.string().min(1),
  uslmIdentifier: z.string().optional(),
  uscTitle: z.string().min(1),
  uscChapter: z.string().min(1),
  uscSection: z.string().min(1),
  heading: z.string(),
  status: z.enum(['active', 'repealed', 'reserved', 'omitted', 'transferred', 'renumbered']),
  bodyMarkdown: z.string(),
  sourceCredits: z.array(z.string()).default([]),
  notes: z.array(StructuredNoteSchema).default([]),
  tables: z.array(StructuredTableSchema).default([]),
  unsupportedStructures: z.array(z.object({
    elementName: z.string(),
    locator: z.string(),
    fallbackText: z.string(),
    reason: z.string(),
  })).default([]),
  evidenceIds: z.array(z.string()).default([]),
  legacyDerived: z.boolean().default(false),
  sourceQualification: HistoricalSourceQualificationSchema.optional(),
  renderedHtml: z.string().max(2 * 1024 ** 2).optional(),
});
export type ProvisionVersion = z.infer<typeof ProvisionVersionSchema>;

export const SnapshotMembershipSchema = z.object({
  schemaVersion: z.literal('usct.snapshot-membership/v1').default('usct.snapshot-membership/v1'),
  membershipId: z.string().min(1),
  sourceReleaseId: z.string().min(1),
  provisionVersionId: z.string().min(1),
  provisionId: z.string().min(1),
  sourceOrder: z.number().int().nonnegative(),
  hierarchyPath: z.string().min(1),
  sourceLocator: z.string().min(1),
});
export type SnapshotMembership = z.infer<typeof SnapshotMembershipSchema>;

/** CitationAssignment & Identity Transitions (DATA-CONTRACTS.md §4, USCT-011) */
export const IdentityTransitionKindSchema = z.enum([
  'renumbered_to',
  'transferred_to',
  'split_into',
  'merged_into',
  'repealed_by',
  'reenacted_by',
]);
export type IdentityTransitionKind = z.infer<typeof IdentityTransitionKindSchema>;

export const CitationAssignmentSchema = z.object({
  schemaVersion: z.literal('usct.citation-assignment/v1').default('usct.citation-assignment/v1'),
  assignmentId: z.string().min(1),
  provisionId: z.string().min(1),
  normalizedCitation: z.string().min(1), // e.g., "18 U.S.C. 111"
  legacySlug: z.string().min(1), // e.g., "title-18/chapter-7/section-111"
  publisherIdentifier: z.string().optional(), // e.g., "/us/usc/t18/s111"
  releaseIds: z.array(z.string()).min(1),
  evidenceIds: z.array(z.string()).default([]),
  editorialReview: EditorialReviewStateSchema.default('accepted'),
});
export type CitationAssignment = z.infer<typeof CitationAssignmentSchema>;

export const IdentityTransitionSchema = z.object({
  schemaVersion: z.literal('usct.identity-transition/v1').default('usct.identity-transition/v1'),
  transitionId: z.string().min(1),
  transitionKind: IdentityTransitionKindSchema,
  fromProvisionId: z.string().min(1),
  fromCitation: z.string().min(1),
  toProvisionIds: z.array(z.string()), // empty if unresolved/ambiguous or repealed
  toCitations: z.array(z.string()),
  effectiveReleaseId: z.string().optional(),
  enactingPublicLaw: z.string().optional(),
  extractionState: ExtractionStateSchema,
  editorialReview: EditorialReviewStateSchema,
  ambiguityNote: z.string().optional(),
  evidenceIds: z.array(z.string()).default([]),
});
export type IdentityTransition = z.infer<typeof IdentityTransitionSchema>;

/** LegalAssertion (DATA-CONTRACTS.md §5) */
export const LegalRelationTypeSchema = z.enum([
  'cites',
  'authority_citation',
  'implements_verified',
  'amends',
  'transfers',
  'supersedes',
  'judicial_proposition',
  'rulemaking_context',
  'guidance_context',
]);
export type LegalRelationType = z.infer<typeof LegalRelationTypeSchema>;

export const LegalAssertionSchema = z.object({
  schemaVersion: z.literal('usct.legal-assertion/v1').default('usct.legal-assertion/v1'),
  assertionId: z.string().min(1),
  subjectId: z.string().min(1),
  relationType: LegalRelationTypeSchema,
  objectId: z.string().optional(),
  unresolvedTargetCitation: z.string().optional(),
  authorityKind: LegalAuthorityKindSchema,
  extractionMethod: z.string().min(1),
  extractorVersion: z.string().min(1),
  extractionState: ExtractionStateSchema,
  editorialReview: EditorialReviewStateSchema,
  propositionText: z.string().max(2000).optional(),
  versionAlignmentState: StatuteVersionAlignmentStateSchema.default('unknown'),
  applicabilityClaimIds: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  supersedesAssertionId: z.string().optional(),
  reviewerId: z.string().optional(),
  reviewRationale: z.string().optional(),
  reviewedAt: z.string().datetime().optional(),
});
export type LegalAssertion = z.infer<typeof LegalAssertionSchema>;

/** CollectionCoverage (DATA-CONTRACTS.md §7, USCT-012) */
export const CollectionCoverageSchema = z.object({
  schemaVersion: z.literal('usct.collection-coverage/v1').default('usct.collection-coverage/v1'),
  coverageId: z.string().min(1),
  sourceScope: z.string().min(1), // e.g. "olrc:pl-119-73", "olrc:pl-119-73:title-18", "courtlistener:title-18"
  sourceFamily: z.enum(['olrc_uslm', 'govinfo_plaw', 'ecfr', 'courtlistener', 'federal_register', 'agency_guidance']),
  releaseId: z.string().optional(),
  titleFilter: z.string().optional(),
  expectedPartitions: z.array(z.string()),
  completedPartitions: z.array(z.string()),
  absentPartitions: z.array(z.string()).default([]),
  failedPartitions: z.array(z.object({
    partition: z.string(),
    reason: z.string(),
    failureKind: SourceFetchFailureKindSchema.optional(),
  })).default([]),
  coverageState: CollectionCoverageStateSchema,
  lastAttemptedAt: z.string().datetime(),
  lastCompletedAt: z.string().datetime().optional(),
  isRequiredForPublication: z.boolean().default(true),
});
export type CollectionCoverage = z.infer<typeof CollectionCoverageSchema>;

/** PublicationManifest & Minimal Publication Receipt (DATA-CONTRACTS.md §10, USCT-033 & USCT-020) */
export const PublicationReceiptSchema = z.object({
  schemaVersion: z.literal('usct.publication-receipt/v1').default('usct.publication-receipt/v1'),
  publicationId: z.string().min(1),
  acceptedDataCommitSha: z.string().regex(/^[0-9a-f]{40}$/i),
  acceptedDataTag: z.string().min(1),
  trackerSubmodulePinSha: z.string().regex(/^[0-9a-f]{40}$/i),
  trackerBuildCommitSha: z.string().regex(/^[0-9a-f]{40}$/i),
  predecessorPublicationId: z.string().optional(),
  predecessorDataCommitSha: z.string().regex(/^[0-9a-f]{40}$/i).optional(),
  promotedAt: z.string().datetime(),
  validationPassed: z.boolean(),
  requiredScopesComplete: z.boolean(),
  manifestDigest: Sha256HexSchema,
});
export type PublicationReceipt = z.infer<typeof PublicationReceiptSchema>;

// --- Interfaces ---

/** Fetches US Code release points from the OLRC */
export interface IUsCodeFetcher {
  /** List available release points, optionally filtered by title */
  listReleasePoints(title?: string): Promise<Result<ReleasePoint[]>>;
  /** Download XML content for a specific release point */
  fetchXml(releasePoint: ReleasePoint): Promise<Result<string>>;
}

/** Converts OLRC XML to Markdown */
export interface IXmlToMarkdownAdapter {
  /** Transform a single XML document to Markdown */
  transform(xml: string): Result<string>;
}

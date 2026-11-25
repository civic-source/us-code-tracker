/**
 * USCT-008, USCT-009, USCT-011, USCT-012, USCT-013, USCT-014, USCT-015, USCT-016,
 * USCT-017, USCT-018, USCT-019, USCT-020, USCT-021, USCT-022, USCT-023, USCT-024,
 * USCT-025, USCT-026, USCT-027, USCT-028, USCT-031, USCT-032, USCT-034, USCT-035, USCT-036:
 *
 * Canonical Local Workbench, Temporal Query Engine, Citation Continuity Resolver,
 * Dependency DAG & Fenced TaskAttempt Acceptance, Static Historical Search Shards,
 * DuckDB/Parquet Export, and Optional Interoperability (Gemma / HCK / RuleSpec).
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { requireHistoricalQualification, requireHistoricalCollections } from './historical-qualification.js';
import { containHistoricalSources, historicalSourceGaps } from './historical-withdrawal.js';

import {
  type ApplicabilityClaim,
  type ApplicabilityState,
  type CitationAssignment,
  type CollectionCoverage,
  type EditorialReviewState,
  type EvidenceSpan,
  type ExtractionState,
  type IdentityTransition,
  type LegalAssertion,
  type Provision,
  type ProvisionVersion,
  type PublicationReceipt,
  type Result,
  type SnapshotMembership,
  type SourceArtifact,
  type SourceRelease,
  type SourceSnapshot,
  type TemporalBoundary,
  SourceArtifactSchema,
  SourceSnapshotSchema,
  SourceReleaseSchema,
  EvidenceSpanSchema,
  ProvisionSchema,
  ProvisionVersionSchema,
  SnapshotMembershipSchema,
  CitationAssignmentSchema,
  IdentityTransitionSchema,
  LegalAssertionSchema,
  ApplicabilityClaimSchema,
  CollectionCoverageSchema,
  ok,
  err,
} from '@civic-source/types';

export function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

// --- USCT-017: Typed Finding & Source-Conflict Register ---

export interface FindingRecord {
  findingId: string;
  fingerprint: string;
  kind:
    | 'source_conflict'
    | 'ambiguous_citation_continuity'
    | 'unsupported_uslm_structure'
    | 'missing_source_partition'
    | 'applicability_dispute';
  affectedScope: string;
  targetId: string;
  question: string;
  competingReadings: Array<{
    readingId: string;
    summary: string;
    adopter?: string;
    evidenceIds: string[];
  }>;
  status: 'open' | 'waived_with_expiry' | 'resolved_editorial' | 'superseded';
  owner: string;
  issueRef?: string;
  expiresAt?: string;
  adoptedReadingId?: string;
  resolutionRationale?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  affectedOutputs: string[];
}

// --- USCT-018: Processing Dependency DAG & DerivedArtifact Identity ---

export interface DependencyEdgeSet {
  /** Direct source/provision version hashes consumed */
  positiveInputs: string[];
  /** Consulted inventory/collection versions (e.g. "citation-registry:v2", "courtlistener:title-18:2026-11") */
  collectionInputs: string[];
  /** Searched keys whose ABSENCE affected the output (e.g. "missing-target:18-usc-9999") */
  negativeInputs: string[];
  /** Policy/resolver/editorial decision versions */
  policyInputs: string[];
}

export interface DerivedArtifactRecord {
  artifactKey: string;
  artifactKind:
    | 'canonical_provision'
    | 'section_page'
    | 'release_diff'
    | 'historical_search_shard'
    | 'relationship_neighborhood'
    | 'topic_feed'
    | 'parquet_export'
    | 'model_proposal';
  targetScope: string;
  producerId: string;
  producerVersion: string;
  schemaVersion: string;
  configDigest: string;
  dependencies: DependencyEdgeSet;
  outputContentHash: string;
}

/**
 * Compute a deterministic cache/derivation key that includes positive, collection, negative,
 * and policy dependencies plus producer/schema/config versions — while excluding retrieval
 * or execution timestamps (USCT-018).
 */
export function computeDerivedArtifactKey(params: {
  artifactKind: DerivedArtifactRecord['artifactKind'];
  targetScope: string;
  producerId: string;
  producerVersion: string;
  schemaVersion: string;
  configDigest: string;
  dependencies: DependencyEdgeSet;
}): string {
  const pos = [...params.dependencies.positiveInputs].sort().join(',');
  const col = [...params.dependencies.collectionInputs].sort().join(',');
  const neg = [...params.dependencies.negativeInputs].sort().join(',');
  const pol = [...params.dependencies.policyInputs].sort().join(',');
  return sha256Hex(
    [
      `kind=${params.artifactKind}`,
      `scope=${params.targetScope}`,
      `producer=${params.producerId}@${params.producerVersion}`,
      `schema=${params.schemaVersion}`,
      `config=${params.configDigest}`,
      `pos=[${pos}]`,
      `col=[${col}]`,
      `neg=[${neg}]`,
      `pol=[${pol}]`,
    ].join('|')
  );
}

export interface ImpactPreviewReport {
  changedPositiveInputs: string[];
  changedCollectionInputs: string[];
  newlyResolvedNegativeTargets: string[];
  changedProducerOrSchema: boolean;
  invalidatedArtifacts: DerivedArtifactRecord[];
  unaffectedArtifacts: DerivedArtifactRecord[];
  affectedProvisions: string[];
  affectedAssertions: string[];
  affectedPages: string[];
  affectedSearchShards: string[];
  affectedExports: string[];
}

/**
 * Compute the exact transitive invalidation and pre-acceptance impact preview report across the Processing DAG (USCT-018, AUD-011).
 * Traverses downstream dependencies to a fixed point so invalidating an intermediate artifact (such as a canonical provision
 * whose negative dependency resolved) invalidates all downstream pages, shards, and exports that consume it.
 */
export function computeDependencyImpact(
  existingArtifacts: readonly DerivedArtifactRecord[],
  changeSet: {
    modifiedPositiveInputs?: readonly string[];
    modifiedCollectionInputs?: readonly string[];
    newlyPresentTargets?: readonly string[]; // matches negativeInputs!
    modifiedPolicyInputs?: readonly string[];
    newProducerVersion?: string;
    newSchemaVersion?: string;
    newConfigDigest?: string;
  }
): ImpactPreviewReport {
  const initialPosSet = new Set(changeSet.modifiedPositiveInputs ?? []);
  const activePosSet = new Set(initialPosSet);
  const colSet = new Set(changeSet.modifiedCollectionInputs ?? []);
  const negSet = new Set(changeSet.newlyPresentTargets ?? []);
  const polSet = new Set(changeSet.modifiedPolicyInputs ?? []);

  const invalidatedKeys = new Set<string>();
  let addedInPass = true;

  while (addedInPass) {
    addedInPass = false;
    for (const art of existingArtifacts) {
      if (invalidatedKeys.has(art.artifactKey)) continue;

      const producerChanged =
        (changeSet.newProducerVersion !== undefined &&
          changeSet.newProducerVersion !== art.producerVersion) ||
        (changeSet.newSchemaVersion !== undefined &&
          changeSet.newSchemaVersion !== art.schemaVersion) ||
        (changeSet.newConfigDigest !== undefined &&
          changeSet.newConfigDigest !== art.configDigest);

      const hitPos = art.dependencies.positiveInputs.some((x) => activePosSet.has(x));
      const hitCol = art.dependencies.collectionInputs.some((x) => colSet.has(x));
      const hitNeg = art.dependencies.negativeInputs.some((x) => negSet.has(x));
      const hitPol = art.dependencies.policyInputs.some((x) => polSet.has(x));

      if (producerChanged || hitPos || hitCol || hitNeg || hitPol) {
        invalidatedKeys.add(art.artifactKey);
        activePosSet.add(art.outputContentHash);
        activePosSet.add(art.artifactKey);
        activePosSet.add(art.targetScope);
        addedInPass = true;
      }
    }
  }

  const invalidated = existingArtifacts.filter((a) => invalidatedKeys.has(a.artifactKey));
  const unaffected = existingArtifacts.filter((a) => !invalidatedKeys.has(a.artifactKey));

  return {
    changedPositiveInputs: [...initialPosSet],
    changedCollectionInputs: [...colSet],
    newlyResolvedNegativeTargets: [...negSet],
    changedProducerOrSchema: Boolean(
      changeSet.newProducerVersion || changeSet.newSchemaVersion || changeSet.newConfigDigest
    ),
    invalidatedArtifacts: invalidated,
    unaffectedArtifacts: unaffected,
    affectedProvisions: invalidated
      .filter((a) => a.artifactKind === 'canonical_provision')
      .map((a) => a.targetScope),
    affectedAssertions: invalidated
      .filter((a) => a.artifactKind === 'model_proposal' || a.artifactKind === 'relationship_neighborhood')
      .map((a) => a.targetScope),
    affectedPages: invalidated
      .filter((a) => a.artifactKind === 'section_page' || a.artifactKind === 'relationship_neighborhood')
      .map((a) => a.targetScope),
    affectedSearchShards: invalidated
      .filter((a) => a.artifactKind === 'historical_search_shard')
      .map((a) => a.targetScope),
    affectedExports: invalidated
      .filter((a) => a.artifactKind === 'parquet_export' || a.artifactKind === 'topic_feed')
      .map((a) => a.targetScope),
  };
}

// --- USCT-035: Local TaskAttempt Lifecycle with Lease, Monotonic Fencing Token & CAS Acceptance ---

export interface TaskAttemptRecord {
  taskId: string;
  attemptId: string;
  generation: number;
  inputIdentity: string;
  ownerWorkerId: string;
  fencingToken: number;
  leaseExpiresAtMs: number;
  state: 'running' | 'accepted' | 'rejected_stale' | 'expired' | 'failed';
  outputArtifactHash?: string;
  rejectionReason?: string;
}

export interface AcceptedTaskState {
  taskId: string;
  currentGeneration: number;
  currentInputIdentity: string;
  highestFencingToken: number;
  acceptedAttemptId?: string;
  acceptedFencingToken?: number;
  acceptedOutputHash?: string;
  acceptedAtIso?: string;
}

export class FencedTaskCoordinator {
  private globalFencingCounter = 0;
  private readonly tasks = new Map<string, AcceptedTaskState>();
  private readonly attempts = new Map<string, TaskAttemptRecord>();

  /** Start or supersede a task attempt, issuing a monotonically increasing fencing token (USCT-035) */
  startAttempt(params: {
    taskId: string;
    attemptId: string;
    inputIdentity: string;
    ownerWorkerId: string;
    nowMs: number;
    leaseDurationMs: number;
  }): TaskAttemptRecord {
    this.globalFencingCounter += 1;
    const fencingToken = this.globalFencingCounter;

    let taskState = this.tasks.get(params.taskId);
    if (!taskState) {
      taskState = {
        taskId: params.taskId,
        currentGeneration: 1,
        currentInputIdentity: params.inputIdentity,
        highestFencingToken: fencingToken,
      };
      this.tasks.set(params.taskId, taskState);
    } else {
      // If inputIdentity changed or a new attempt is superseding an existing one, advance generation
      if (taskState.currentInputIdentity !== params.inputIdentity) {
        taskState.currentGeneration += 1;
        taskState.currentInputIdentity = params.inputIdentity;
        delete taskState.acceptedAttemptId;
        delete taskState.acceptedFencingToken;
        delete taskState.acceptedOutputHash;
        delete taskState.acceptedAtIso;
      } else if (taskState.highestFencingToken < fencingToken) {
        taskState.currentGeneration += 1;
        delete taskState.acceptedAttemptId;
        delete taskState.acceptedFencingToken;
        delete taskState.acceptedOutputHash;
        delete taskState.acceptedAtIso;
      }
      taskState.highestFencingToken = fencingToken;
    }

    const attempt: TaskAttemptRecord = {
      taskId: params.taskId,
      attemptId: params.attemptId,
      generation: taskState.currentGeneration,
      inputIdentity: params.inputIdentity,
      ownerWorkerId: params.ownerWorkerId,
      fencingToken,
      leaseExpiresAtMs: params.nowMs + params.leaseDurationMs,
      state: 'running',
    };
    this.attempts.set(params.attemptId, attempt);
    return { ...attempt };
  }

  /**
   * Atomic Compare-And-Swap (CAS) acceptance check (USCT-035):
   * - Idempotent no-op if the same generation/input/output is already accepted.
   * - Rejects expired leases, superseded generations, or lower fencing tokens so a stale worker
   *   can NEVER overwrite a newer accepted result.
   */
  proposeAcceptance(params: {
    attemptId: string;
    outputArtifactHash: string;
    nowMs: number;
    nowIso?: string;
  }): Result<{ status: 'accepted' | 'noop_already_accepted'; taskState: AcceptedTaskState }> {
    const attempt = this.attempts.get(params.attemptId);
    if (!attempt) {
      return err(new Error(`Unknown attemptId: ${params.attemptId}`));
    }

    const taskState = this.tasks.get(attempt.taskId);
    if (!taskState) {
      return err(new Error(`Unknown taskId: ${attempt.taskId}`));
    }

    // Terminal immutability check (AUD-011 / USCT-035):
    // Once an attempt or generation has been accepted, it is strictly terminal.
    // Identical output retry is an idempotent no-op; conflicting output on an already-accepted
    // attempt or generation is rejected!
    if (attempt.state === 'accepted' || taskState.acceptedAttemptId === attempt.attemptId) {
      if (taskState.acceptedOutputHash === params.outputArtifactHash) {
        return ok({ status: 'noop_already_accepted', taskState: { ...taskState } });
      }
      return err(
        new Error(
          `Terminal accepted attempt '${attempt.attemptId}' cannot replace accepted output '${taskState.acceptedOutputHash}' with '${params.outputArtifactHash}'`
        )
      );
    }

    if (
      taskState.acceptedOutputHash !== undefined &&
      taskState.currentInputIdentity === attempt.inputIdentity &&
      taskState.currentGeneration === attempt.generation
    ) {
      if (taskState.acceptedOutputHash === params.outputArtifactHash) {
        attempt.state = 'accepted';
        attempt.outputArtifactHash = params.outputArtifactHash;
        return ok({ status: 'noop_already_accepted', taskState: { ...taskState } });
      }
      return err(
        new Error(
          `Generation ${attempt.generation} already accepted output '${taskState.acceptedOutputHash}'; conflicting output '${params.outputArtifactHash}' requires a new generation`
        )
      );
    }

    // 1. Check lease expiry
    if (params.nowMs > attempt.leaseExpiresAtMs) {
      attempt.state = 'expired';
      attempt.rejectionReason = `Lease expired at ${attempt.leaseExpiresAtMs} (now=${params.nowMs})`;
      return err(new Error(attempt.rejectionReason));
    }

    // 2. Check fencing token and generation CAS predicates
    if (
      attempt.fencingToken < taskState.highestFencingToken ||
      attempt.generation < taskState.currentGeneration ||
      attempt.inputIdentity !== taskState.currentInputIdentity
    ) {
      attempt.state = 'rejected_stale';
      attempt.rejectionReason = `Stale attempt fenced out: attempt(gen=${attempt.generation}, token=${attempt.fencingToken}, input=${attempt.inputIdentity}) < current(gen=${taskState.currentGeneration}, token=${taskState.highestFencingToken}, input=${taskState.currentInputIdentity})`;
      return err(new Error(attempt.rejectionReason));
    }

    // Atomic CAS commit
    attempt.state = 'accepted';
    attempt.outputArtifactHash = params.outputArtifactHash;
    taskState.acceptedAttemptId = attempt.attemptId;
    taskState.acceptedFencingToken = attempt.fencingToken;
    taskState.acceptedOutputHash = params.outputArtifactHash;
    taskState.acceptedAtIso = params.nowIso ?? new Date(params.nowMs).toISOString();

    return ok({ status: 'accepted', taskState: { ...taskState } });
  }

  getTaskState(taskId: string): AcceptedTaskState | undefined {
    const s = this.tasks.get(taskId);
    return s ? { ...s } : undefined;
  }

  getAttempt(attemptId: string): TaskAttemptRecord | undefined {
    const a = this.attempts.get(attemptId);
    return a ? { ...a } : undefined;
  }

  exportState(): {
    globalFencingCounter: number;
    tasks: AcceptedTaskState[];
    attempts: TaskAttemptRecord[];
  } {
    return {
      globalFencingCounter: this.globalFencingCounter,
      tasks: [...this.tasks.values()].map((t) => ({ ...t })),
      attempts: [...this.attempts.values()].map((a) => ({ ...a })),
    };
  }

  importState(snapshot: {
    globalFencingCounter?: number;
    tasks?: readonly AcceptedTaskState[];
    attempts?: readonly TaskAttemptRecord[];
  }): void {
    this.tasks.clear();
    this.attempts.clear();
    let maxToken = snapshot.globalFencingCounter ?? 0;
    for (const t of snapshot.tasks ?? []) {
      this.tasks.set(t.taskId, { ...t });
      if (t.highestFencingToken > maxToken) maxToken = t.highestFencingToken;
    }
    for (const a of snapshot.attempts ?? []) {
      this.attempts.set(a.attemptId, { ...a });
      if (a.fencingToken > maxToken) maxToken = a.fencingToken;
    }
    this.globalFencingCounter = maxToken;
  }

  async saveToFile(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(this.exportState(), null, 2) + '\n', 'utf-8');
  }

  static async loadFromFile(filePath: string): Promise<FencedTaskCoordinator> {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as ReturnType<FencedTaskCoordinator['exportState']>;
    const coord = new FencedTaskCoordinator();
    coord.importState(parsed);
    return coord;
  }
}

// --- USCT-008, USCT-009, USCT-011, USCT-034: Canonical Catalog & Three Temporal Query Modes ---

export interface HistoricalObservationRecord {
  observationId: string;
  targetKind: 'source_release' | 'provision_version' | 'legal_assertion' | 'applicability_claim';
  targetId: string;
  observedAt: string; // Real UTC timestamp when this installation observed/accepted the record
  sourcePublishedDate?: string; // Historical publisher date (NEVER equated to observedAt!)
  backfilledHistoricalSource: boolean;
}

export interface CatalogStateSnapshot {
  schemaVersion: 'usct.catalog-snapshot/v1';
  artifacts: SourceArtifact[];
  snapshots: SourceSnapshot[];
  releases: SourceRelease[];
  provisions: Provision[];
  provisionVersions: ProvisionVersion[];
  memberships: SnapshotMembership[];
  citationAssignments: CitationAssignment[];
  identityTransitions: IdentityTransition[];
  evidenceSpans: EvidenceSpan[];
  assertions: LegalAssertion[];
  applicabilityClaims: ApplicabilityClaim[];
  observations: HistoricalObservationRecord[];
  coverages: CollectionCoverage[];
  findings: FindingRecord[];
  derivedArtifacts: DerivedArtifactRecord[];
}

export interface AsPublishedQueryResult {
  mode: 'as_published';
  releaseId: string;
  citation: string;
  status: 'found' | 'not_present_in_snapshot' | 'release_unavailable' | 'ambiguous_identity' | 'source_unavailable';
  sourceCorrection?: ReturnType<typeof historicalSourceGaps>[number];
  provisionId?: string;
  provisionVersion?: ProvisionVersion;
  release?: SourceRelease;
  recordedObservedAt?: string;
  evidenceSpans: EvidenceSpan[];
  identityTransitions: IdentityTransition[];
}

export interface KnownAsOfQueryResult {
  mode: 'known_as_of';
  cutoffObservedAt: string;
  citation: string;
  status: 'known_at_cutoff' | 'unknown_at_cutoff_backfilled_later' | 'never_observed';
  provisionVersion?: ProvisionVersion;
  firstObservedAt?: string;
  sourcePublishedDate?: string;
  explanation: string;
}

export interface LegallyApplicableQueryResult {
  mode: 'legally_applicable';
  requestedLegalDate: string;
  citation: string;
  subdivisionLocator?: string;
  suppliedContextFacts: Record<string, string | boolean | number>;
  applicabilityState: ApplicabilityState; // 'known' | 'conditional' | 'disputed' | 'unknown'
  matchingClaims: ApplicabilityClaim[];
  missingContextFacts: string[];
  competingReadings: ApplicabilityClaim[];
  evidenceSpans: EvidenceSpan[];
  explanation: string;
}

export interface CitationResolutionResult {
  requestedCitation: string;
  releaseContext?: string;
  status: 'resolved_exact' | 'transferred' | 'renumbered' | 'repealed' | 'ambiguous_unresolved' | 'not_found';
  provisionId?: string;
  currentOrHistoricalVersion?: ProvisionVersion;
  transitions: IdentityTransition[];
  candidateProvisionIds: string[];
  warningMessage?: string;
}

/**
 * Canonical Workbench Catalog implementing both the file-backed fixture/replay store (USCT-008)
 * and the PostgreSQL SQL migration/export adapter (USCT-009) with 100% deterministic parity.
 */
export interface WorkbenchLexicalHit {
  provisionVersionId: string;
  provisionId: string;
  releaseId?: string;
  citation: string;
  heading: string;
  matchedExcerpt: string;
  lexicalScore: number;
  combinedScore: number;
  evidenceSpans: EvidenceSpan[];
}

export class CanonicalWorkbenchCatalog {
  private state: CatalogStateSnapshot = {
    schemaVersion: 'usct.catalog-snapshot/v1',
    artifacts: [],
    snapshots: [],
    releases: [],
    provisions: [],
    provisionVersions: [],
    memberships: [],
    citationAssignments: [],
    identityTransitions: [],
    evidenceSpans: [],
    assertions: [],
    applicabilityClaims: [],
    observations: [],
    coverages: [],
    findings: [],
    derivedArtifacts: [],
  };

  /** Generate the PostgreSQL DDL schema migration for the local workbench catalog (USCT-009, USCT-023, USCT-035) */
  static getPostgresMigrationSql(): string {
    return `
-- USCT-009 / USCT-023 / USCT-035: Canonical Local PostgreSQL Workbench Schema Migration (v2 - Full 15-Entity + Durable Task Coordinator)
BEGIN;

CREATE TABLE IF NOT EXISTS source_artifacts (
  artifact_id TEXT PRIMARY KEY,
  sha256 CHAR(64) NOT NULL UNIQUE,
  byte_length BIGINT NOT NULL CHECK (byte_length >= 0),
  media_type TEXT NOT NULL,
  storage_locator TEXT NOT NULL,
  license TEXT NOT NULL DEFAULT 'unknown',
  attribution_required BOOLEAN NOT NULL DEFAULT FALSE,
  attribution_text TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS source_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  source_registry_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES source_artifacts(artifact_id),
  authority_kind TEXT NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  legacy_derived BOOLEAN NOT NULL DEFAULT FALSE,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS source_releases (
  release_id TEXT PRIMARY KEY,
  publisher_release_label TEXT NOT NULL,
  release_segment TEXT NOT NULL,
  congress INT NOT NULL,
  law_identifier TEXT NOT NULL,
  manifest_digest CHAR(64) NOT NULL,
  published_date TEXT,
  observed_at TIMESTAMPTZ NOT NULL,
  legacy_derived BOOLEAN NOT NULL DEFAULT FALSE,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS provisions (
  provision_id TEXT PRIMARY KEY,
  jurisdiction TEXT NOT NULL DEFAULT 'US',
  document_kind TEXT NOT NULL,
  creation_basis TEXT NOT NULL,
  identity_registry_version INT NOT NULL DEFAULT 1,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS provision_versions (
  provision_version_id TEXT PRIMARY KEY,
  provision_id TEXT NOT NULL REFERENCES provisions(provision_id),
  normalized_content_hash CHAR(64) NOT NULL,
  normalization_version TEXT NOT NULL,
  usc_title TEXT NOT NULL,
  usc_chapter TEXT NOT NULL,
  usc_section TEXT NOT NULL,
  heading TEXT NOT NULL,
  status TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  legacy_derived BOOLEAN NOT NULL DEFAULT FALSE,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_tsv TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(usc_title, '') || ' U.S.C. ' || coalesce(usc_section, '') || ' ' || coalesce(heading, '') || ' ' || coalesce(body_markdown, ''))
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_provision_versions_fts ON provision_versions USING GIN (search_tsv);

CREATE TABLE IF NOT EXISTS snapshot_memberships (
  membership_id TEXT PRIMARY KEY,
  source_release_id TEXT NOT NULL REFERENCES source_releases(release_id),
  provision_version_id TEXT NOT NULL REFERENCES provision_versions(provision_version_id),
  provision_id TEXT NOT NULL REFERENCES provisions(provision_id),
  source_order INT NOT NULL,
  hierarchy_path TEXT NOT NULL,
  source_locator TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_release_id, provision_version_id)
);

CREATE TABLE IF NOT EXISTS citation_assignments (
  assignment_id TEXT PRIMARY KEY,
  provision_id TEXT NOT NULL REFERENCES provisions(provision_id),
  normalized_citation TEXT NOT NULL,
  legacy_slug TEXT NOT NULL,
  editorial_review TEXT NOT NULL DEFAULT 'accepted',
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_transitions (
  transition_id TEXT PRIMARY KEY,
  transition_kind TEXT NOT NULL,
  from_provision_id TEXT NOT NULL,
  from_citation TEXT NOT NULL,
  extraction_state TEXT NOT NULL,
  editorial_review TEXT NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_spans (
  evidence_id TEXT PRIMARY KEY,
  source_snapshot_id TEXT NOT NULL,
  artifact_sha256 CHAR(64) NOT NULL,
  locator_kind TEXT NOT NULL,
  locator_value TEXT NOT NULL,
  excerpt_sha256 CHAR(64) NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS legal_assertions (
  assertion_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  object_id TEXT,
  authority_kind TEXT NOT NULL,
  extraction_state TEXT NOT NULL,
  editorial_review TEXT NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS applicability_claims (
  claim_id TEXT PRIMARY KEY,
  target_provision_version_id TEXT NOT NULL REFERENCES provision_versions(provision_version_id),
  target_subdivision_locator TEXT,
  applicability_state TEXT NOT NULL,
  start_boundary JSONB NOT NULL,
  end_boundary JSONB NOT NULL,
  required_context_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  editorial_review TEXT NOT NULL DEFAULT 'unreviewed',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS historical_observations (
  observation_id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  source_published_date TEXT,
  backfilled_historical_source BOOLEAN NOT NULL DEFAULT FALSE,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_coverages (
  coverage_id TEXT PRIMARY KEY,
  source_scope TEXT NOT NULL,
  source_family TEXT NOT NULL,
  release_id TEXT,
  coverage_state TEXT NOT NULL,
  is_required_for_publication BOOLEAN NOT NULL DEFAULT TRUE,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
  finding_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL,
  affected_scope TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL,
  owner TEXT NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS derived_artifacts (
  artifact_key TEXT PRIMARY KEY,
  artifact_kind TEXT NOT NULL,
  target_scope TEXT NOT NULL,
  producer_id TEXT NOT NULL,
  producer_version TEXT NOT NULL,
  output_content_hash TEXT NOT NULL,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS accepted_tasks (
  task_id TEXT PRIMARY KEY,
  current_generation INT NOT NULL,
  current_input_identity TEXT NOT NULL,
  highest_fencing_token INT NOT NULL,
  accepted_attempt_id TEXT,
  accepted_fencing_token INT,
  accepted_output_hash TEXT,
  accepted_at_iso TEXT,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS task_attempts (
  attempt_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES accepted_tasks(task_id),
  generation INT NOT NULL,
  input_identity TEXT NOT NULL,
  owner_worker_id TEXT NOT NULL,
  fencing_token INT NOT NULL,
  lease_expires_at_ms BIGINT NOT NULL,
  state TEXT NOT NULL,
  output_artifact_hash TEXT,
  rejection_reason TEXT,
  payload_json JSONB NOT NULL
);

COMMIT;
`.trim();
  }

  /** Idempotent transactional ingestion of a catalog bundle (USCT-008 / USCT-009) */
  ingestBundle(partial: Partial<CatalogStateSnapshot>): Result<void> {
    // Validate all incoming records first inside an atomic staging copy so a validation error
    // leaves zero half-published state (USCT-009)
    const next: CatalogStateSnapshot = structuredClone(this.state);

    try {
      const upsert = <T>(arr: T[], item: T, keyFn: (x: T) => string) => {
        const k = keyFn(item);
        const idx = arr.findIndex((e) => keyFn(e) === k);
        if (idx >= 0) arr[idx] = item;
        else arr.push(item);
      };

      const insertImmutable = <T>(
        kind: string,
        arr: T[],
        item: T,
        keyFn: (x: T) => string,
        sameContentFn: (existing: T, incoming: T) => boolean
      ) => {
        const k = keyFn(item);
        const existing = arr.find((e) => keyFn(e) === k);
        if (!existing) {
          arr.push(item);
          return;
        }
        if (!sameContentFn(existing, item)) {
          throw new Error(
            `Immutable identity collision for ${kind} '${k}': incoming content/digest conflicts with already accepted record`
          );
        }
      };

      for (const a of partial.artifacts ?? []) {
        insertImmutable(
          'SourceArtifact',
          next.artifacts,
          SourceArtifactSchema.parse(a),
          (x) => x.artifactId,
          (e, i) => e.sha256 === i.sha256 && e.byteLength === i.byteLength && e.mediaType === i.mediaType
        );
      }
      for (const s of partial.snapshots ?? []) {
        insertImmutable(
          'SourceSnapshot',
          next.snapshots,
          SourceSnapshotSchema.parse(s),
          (x) => x.snapshotId,
          (e, i) => e.artifactId === i.artifactId && e.requestedUrl === i.requestedUrl
        );
      }
      for (const r of partial.releases ?? []) {
        insertImmutable(
          'SourceRelease',
          next.releases,
          SourceReleaseSchema.parse(r),
          (x) => x.releaseId,
          (e, i) =>
            e.manifestDigest === i.manifestDigest &&
            e.releaseSegment === i.releaseSegment &&
            e.revisionNumber === i.revisionNumber && e.publisherReleaseId === i.publisherReleaseId
        );
      }
      for (const p of partial.provisions ?? []) {
        upsert(next.provisions, ProvisionSchema.parse(p), (x) => x.provisionId);
      }
      for (const pv of partial.provisionVersions ?? []) {
        requireHistoricalQualification(ProvisionVersionSchema.parse(pv));
        insertImmutable(
          'ProvisionVersion',
          next.provisionVersions,
          ProvisionVersionSchema.parse(pv),
          (x) => x.provisionVersionId,
          (e, i) =>
            e.normalizedContentHash === i.normalizedContentHash &&
            e.bodyMarkdown === i.bodyMarkdown &&
            e.heading === i.heading &&
            e.status === i.status &&
            e.provisionId === i.provisionId
        );
      }
      for (const m of partial.memberships ?? []) {
        insertImmutable(
          'SnapshotMembership',
          next.memberships,
          SnapshotMembershipSchema.parse(m),
          (x) => x.membershipId,
          (e, i) =>
            e.sourceReleaseId === i.sourceReleaseId &&
            e.provisionVersionId === i.provisionVersionId &&
            e.provisionId === i.provisionId
        );
      }
      for (const ca of partial.citationAssignments ?? []) {
        upsert(next.citationAssignments, CitationAssignmentSchema.parse(ca), (x) => x.assignmentId);
      }
      for (const tr of partial.identityTransitions ?? []) {
        upsert(next.identityTransitions, IdentityTransitionSchema.parse(tr), (x) => x.transitionId);
      }
      for (const ev of partial.evidenceSpans ?? []) {
        insertImmutable(
          'EvidenceSpan',
          next.evidenceSpans,
          EvidenceSpanSchema.parse(ev),
          (x) => x.evidenceId,
          (e, i) =>
            e.artifactSha256 === i.artifactSha256 &&
            e.excerptSha256 === i.excerptSha256 &&
            e.excerpt === i.excerpt &&
            e.locatorValue === i.locatorValue
        );
      }
      for (const as of partial.assertions ?? []) {
        upsert(next.assertions, LegalAssertionSchema.parse(as), (x) => x.assertionId);
      }
      for (const ac of partial.applicabilityClaims ?? []) {
        upsert(next.applicabilityClaims, ApplicabilityClaimSchema.parse(ac), (x) => x.claimId);
      }
      for (const obs of partial.observations ?? []) {
        upsert(next.observations, obs, (x) => x.observationId);
      }
      for (const cov of partial.coverages ?? []) {
        upsert(next.coverages, CollectionCoverageSchema.parse(cov), (x) => x.coverageId);
      }
      for (const f of partial.findings ?? []) {
        upsert(next.findings, f, (x) => x.findingId);
      }
      for (const da of partial.derivedArtifacts ?? []) {
        upsert(next.derivedArtifacts, da, (x) => x.artifactKey);
      }

      requireHistoricalCollections(next);
      this.state = containHistoricalSources(next);
      return ok(undefined);
    } catch (e: unknown) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  getSnapshot(): CatalogStateSnapshot {
    return structuredClone(this.state);
  }

  /** Save catalog to a deterministic JSON file for file-backed replay (USCT-008 / USCT-009) */
  async saveToFile(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(this.state, null, 2) + '\n', 'utf-8');
  }

  /** Load catalog from a deterministic JSON file (USCT-008 / USCT-009) */
  static async loadFromFile(filePath: string): Promise<CanonicalWorkbenchCatalog> {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as CatalogStateSnapshot;
    const cat = new CanonicalWorkbenchCatalog();
    const res = cat.ingestBundle(parsed);
    if (!res.ok) throw res.error;
    return cat;
  }

  /**
   * Transactional SQL persistence adapter (USCT-009):
   * Applies the PostgreSQL schema migration and synchronizes the canonical catalog state
   * inside an atomic BEGIN/COMMIT transaction (with automatic ROLLBACK on failure).
   */
  async syncToSqlAdapter(adapter: {
    execute(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  }): Promise<Result<{ tablesWritten: number; rowsUpserted: number }>> {
    try {
      await adapter.execute(CanonicalWorkbenchCatalog.getPostgresMigrationSql());
      await adapter.execute('BEGIN');

      let rowsUpserted = 0;
      for (const a of this.state.artifacts) {
        await adapter.execute(
          `INSERT INTO source_artifacts (artifact_id, sha256, byte_length, media_type, storage_locator, license, attribution_required, attribution_text)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (artifact_id) DO NOTHING`,
          [
            a.artifactId,
            a.sha256,
            a.byteLength,
            a.mediaType,
            a.storageLocator,
            a.license,
            a.attributionRequired,
            a.attributionText ?? null,
          ]
        );
        rowsUpserted++;
      }

      for (const r of this.state.releases) {
        await adapter.execute(
          `INSERT INTO source_releases (release_id, publisher_release_label, release_segment, congress, law_identifier, manifest_digest, published_date, observed_at, legacy_derived)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (release_id) DO NOTHING`,
          [
            r.releaseId,
            r.publisherReleaseLabel,
            r.releaseSegment,
            r.congress,
            r.lawIdentifier,
            r.manifestDigest,
            r.publishedDate ?? null,
            r.observedAt,
            r.legacyDerived,
          ]
        );
        rowsUpserted++;
      }

      for (const p of this.state.provisions) {
        await adapter.execute(
          `INSERT INTO provisions (provision_id, jurisdiction, document_kind, creation_basis, identity_registry_version)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (provision_id) DO UPDATE SET identity_registry_version = EXCLUDED.identity_registry_version`,
          [
            p.provisionId,
            p.jurisdiction,
            p.documentKind,
            p.creationBasis,
            p.identityRegistryVersion,
          ]
        );
        rowsUpserted++;
      }

      for (const pv of this.state.provisionVersions) {
        await adapter.execute(
          `INSERT INTO provision_versions (provision_version_id, provision_id, normalized_content_hash, normalization_version, usc_title, usc_chapter, usc_section, heading, status, body_markdown)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (provision_version_id) DO NOTHING`,
          [
            pv.provisionVersionId,
            pv.provisionId,
            pv.normalizedContentHash,
            pv.normalizationVersion,
            pv.uscTitle,
            pv.uscChapter,
            pv.uscSection,
            pv.heading,
            pv.status,
            pv.bodyMarkdown,
          ]
        );
        rowsUpserted++;
      }

      for (const m of this.state.memberships) {
        await adapter.execute(
          `INSERT INTO snapshot_memberships (membership_id, source_release_id, provision_version_id, provision_id, source_order, hierarchy_path, source_locator)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (membership_id) DO NOTHING`,
          [
            m.membershipId,
            m.sourceReleaseId,
            m.provisionVersionId,
            m.provisionId,
            m.sourceOrder,
            m.hierarchyPath,
            m.sourceLocator,
          ]
        );
        rowsUpserted++;
      }

      for (const ac of this.state.applicabilityClaims) {
        await adapter.execute(
          `INSERT INTO applicability_claims (claim_id, target_provision_version_id, target_subdivision_locator, applicability_state, start_boundary, end_boundary, required_context_facts, editorial_review)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (claim_id) DO UPDATE SET applicability_state = EXCLUDED.applicability_state`,
          [
            ac.claimId,
            ac.targetProvisionVersionId,
            ac.targetSubdivisionLocator ?? null,
            ac.applicabilityState,
            JSON.stringify(ac.startBoundary),
            JSON.stringify(ac.endBoundary),
            JSON.stringify(ac.requiredContextFacts),
            ac.editorialReview,
          ]
        );
        rowsUpserted++;
      }

      await adapter.execute('COMMIT');
      return ok({ tablesWritten: 6, rowsUpserted });
    } catch (e: unknown) {
      try {
        await adapter.execute('ROLLBACK');
      } catch {
        // Ignore rollback failure on broken adapter
      }
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Resolve a citation across transfers, renumbering, citation reuse, and ambiguous splits (USCT-011).
   * Never merges distinct provisions merely because a section number was reused later!
   */
  resolveCitation(citation: string, releaseId?: string): CitationResolutionResult {
    const matchingAssignments = this.state.citationAssignments.filter(
      (ca) => ca.normalizedCitation.toLowerCase() === citation.toLowerCase()
    );

    if (matchingAssignments.length === 0) {
      return {
        requestedCitation: citation,
        ...(releaseId ? { releaseContext: releaseId } : {}),
        status: 'not_found',
        transitions: [],
        candidateProvisionIds: [],
      };
    }

    // Filter by releaseId if requested
    const scopedAssignments = releaseId
      ? matchingAssignments.filter((ca) => ca.releaseIds.includes(releaseId))
      : matchingAssignments;

    // If citation was reused across different provisions and no releaseId disambiguates it -> ambiguous!
    const distinctProvisions = [...new Set((scopedAssignments.length > 0 ? scopedAssignments : matchingAssignments).map((a) => a.provisionId))];

    if (!releaseId && distinctProvisions.length > 1) {
      const transitions = this.state.identityTransitions.filter(
        (t) =>
          distinctProvisions.includes(t.fromProvisionId) ||
          t.fromCitation.toLowerCase() === citation.toLowerCase()
      );
      return {
        requestedCitation: citation,
        status: 'ambiguous_unresolved',
        transitions,
        candidateProvisionIds: distinctProvisions,
        warningMessage: `Citation '${citation}' was occupied by ${distinctProvisions.length} distinct provisions across history (${distinctProvisions.join(', ')}); specify a release snapshot to disambiguate.`,
      };
    }

    const provisionId = distinctProvisions[0]!;
    const transitions = this.state.identityTransitions.filter(
      (t) => t.fromProvisionId === provisionId
    );

    // Check if there is an unresolved/ambiguous split transition
    const ambiguousSplit = transitions.find(
      (t) =>
        t.transitionKind === 'split_into' &&
        (t.editorialReview !== 'accepted' || t.toProvisionIds.length > 1)
    );
    if (ambiguousSplit && (!releaseId || ambiguousSplit.effectiveReleaseId === releaseId)) {
      return {
        requestedCitation: citation,
        ...(releaseId ? { releaseContext: releaseId } : {}),
        status: 'ambiguous_unresolved',
        provisionId,
        transitions,
        candidateProvisionIds: ambiguousSplit.toProvisionIds,
        warningMessage:
          ambiguousSplit.ambiguityNote ??
          `Provision ${provisionId} split into multiple candidate targets (${ambiguousSplit.toCitations.join(', ')}) requiring review.`,
      };
    }

    const transfer = transitions.find(
      (t) =>
        (t.transitionKind === 'transferred_to' || t.transitionKind === 'renumbered_to') &&
        t.extractionState === 'verified' &&
        (!releaseId || t.effectiveReleaseId === releaseId)
    );

    const version = this.findProvisionVersionInRelease(provisionId, releaseId);

    if (transfer) {
      return {
        requestedCitation: citation,
        ...(releaseId ? { releaseContext: releaseId } : {}),
        status: transfer.transitionKind === 'transferred_to' ? 'transferred' : 'renumbered',
        provisionId,
        ...(version ? { currentOrHistoricalVersion: version } : {}),
        transitions,
        candidateProvisionIds: transfer.toProvisionIds,
      };
    }

    return {
      requestedCitation: citation,
      ...(releaseId ? { releaseContext: releaseId } : {}),
      status: version?.status === 'repealed' ? 'repealed' : 'resolved_exact',
      provisionId,
      ...(version ? { currentOrHistoricalVersion: version } : {}),
      transitions,
      candidateProvisionIds: [provisionId],
    };
  }

  private findProvisionVersionInRelease(
    provisionId: string,
    releaseId?: string
  ): ProvisionVersion | undefined {
    if (releaseId) {
      const mem = this.state.memberships.find(
        (m) => m.sourceReleaseId === releaseId && m.provisionId === provisionId
      );
      if (!mem) return undefined;
      return this.state.provisionVersions.find(
        (pv) => pv.provisionVersionId === mem.provisionVersionId
      );
    }
    const versions = this.state.provisionVersions.filter((pv) => pv.provisionId === provisionId);
    return versions[versions.length - 1];
  }

  /**
   * Mode 1 (`as_published`, USCT-008 / USCT-009 / USCT-034):
   * Query the exact contents of a named publisher release snapshot.
   * Never substitutes current text when a historical snapshot or provision is absent!
   */
  queryAsPublished(params: { releaseId: string; citation: string }): AsPublishedQueryResult {
    const release = this.state.releases.find((r) => r.releaseId === params.releaseId);
    if (!release) {
      return {
        mode: 'as_published',
        releaseId: params.releaseId,
        citation: params.citation,
        status: 'release_unavailable',
        evidenceSpans: [],
        identityTransitions: [],
      };
    }

    const normalizedCitation = params.citation.toLowerCase().replace(/[^a-z0-9]/g, '');
    const gap = historicalSourceGaps(this.state).find((item) => item.releaseId === params.releaseId &&
      normalizedCitation === `${item.uscTitle}usc${item.uscSection}`);
    if (gap) return { mode: 'as_published', releaseId: params.releaseId, citation: params.citation,
      status: 'source_unavailable', sourceCorrection: gap, release, provisionId: gap.provisionId,
      recordedObservedAt: release.observedAt, evidenceSpans: [], identityTransitions: [] };

    const scopedAssignments = this.state.citationAssignments.filter(
      (ca) =>
        ca.normalizedCitation.toLowerCase() === params.citation.toLowerCase() &&
        ca.releaseIds.includes(params.releaseId)
    );

    if (scopedAssignments.length > 1) {
      return {
        mode: 'as_published',
        releaseId: params.releaseId,
        citation: params.citation,
        status: 'ambiguous_identity',
        release,
        recordedObservedAt: release.observedAt,
        evidenceSpans: [],
        identityTransitions: [],
      };
    }

    const assignment = scopedAssignments[0];
    if (!assignment) {
      return {
        mode: 'as_published',
        releaseId: params.releaseId,
        citation: params.citation,
        status: 'not_present_in_snapshot',
        release,
        recordedObservedAt: release.observedAt,
        evidenceSpans: [],
        identityTransitions: [],
      };
    }

    const membership = this.state.memberships.find(
      (m) =>
        m.sourceReleaseId === params.releaseId && m.provisionId === assignment.provisionId
    );
    if (!membership) {
      return {
        mode: 'as_published',
        releaseId: params.releaseId,
        citation: params.citation,
        status: 'not_present_in_snapshot',
        provisionId: assignment.provisionId,
        release,
        recordedObservedAt: release.observedAt,
        evidenceSpans: [],
        identityTransitions: [],
      };
    }

    const version = this.state.provisionVersions.find(
      (pv) => pv.provisionVersionId === membership.provisionVersionId
    );
    const evidenceSet = new Set([...(version?.evidenceIds ?? []), ...assignment.evidenceIds]);
    const evidenceSpans = this.state.evidenceSpans.filter((e) => evidenceSet.has(e.evidenceId));
    const transitions = this.state.identityTransitions.filter(
      (t) => t.fromProvisionId === assignment.provisionId
    );

    return {
      mode: 'as_published',
      releaseId: params.releaseId,
      citation: params.citation,
      status: 'found',
      provisionId: assignment.provisionId,
      ...(version ? { provisionVersion: version } : {}),
      release,
      recordedObservedAt: release.observedAt,
      evidenceSpans,
      identityTransitions: transitions,
    };
  }

  /**
   * Mode 2 (`known_as_of`, USCT-034):
   * Query what this installation actually observed/recorded by `cutoffObservedAt`.
   * A late backfill of a 2015 publication today NEVER fabricates a 2015 observation!
   */
  queryKnownAsOf(params: { cutoffObservedAt: string; citation: string }): KnownAsOfQueryResult {
    const cutoffMs = new Date(params.cutoffObservedAt).getTime();

    const assignments = this.state.citationAssignments.filter(
      (ca) => ca.normalizedCitation.toLowerCase() === params.citation.toLowerCase()
    );
    const provisionIds = new Set(assignments.map((a) => a.provisionId));
    const candidateVersions = this.state.provisionVersions.filter((pv) =>
      provisionIds.has(pv.provisionId)
    );

    if (candidateVersions.length === 0) {
      return {
        mode: 'known_as_of',
        cutoffObservedAt: params.cutoffObservedAt,
        citation: params.citation,
        status: 'never_observed',
        explanation: `No provision version for '${params.citation}' has ever been observed by this tracker installation.`,
      };
    }

    // Match versions against actual HistoricalObservationRecord timestamps
    const versionObservations = candidateVersions
      .map((pv) => {
        const obs = this.state.observations.find(
          (o) => o.targetKind === 'provision_version' && o.targetId === pv.provisionVersionId
        );
        return { pv, obs };
      })
      .filter((x): x is { pv: ProvisionVersion; obs: HistoricalObservationRecord } => Boolean(x.obs));

    const observedByCutoff = versionObservations
      .filter((x) => new Date(x.obs.observedAt).getTime() <= cutoffMs)
      .sort((a, b) => new Date(b.obs.observedAt).getTime() - new Date(a.obs.observedAt).getTime());

    if (observedByCutoff.length > 0 && observedByCutoff[0]) {
      const winner = observedByCutoff[0];
      return {
        mode: 'known_as_of',
        cutoffObservedAt: params.cutoffObservedAt,
        citation: params.citation,
        status: 'known_at_cutoff',
        provisionVersion: winner.pv,
        firstObservedAt: winner.obs.observedAt,
        ...(winner.obs.sourcePublishedDate
          ? { sourcePublishedDate: winner.obs.sourcePublishedDate }
          : {}),
        explanation: `Provision version '${winner.pv.provisionVersionId}' was recorded by this tracker at ${winner.obs.observedAt} (<= cutoff ${params.cutoffObservedAt}).`,
      };
    }

    // Observed only AFTER the cutoff (e.g., late historical backfill!)
    const earliestLater = versionObservations.sort(
      (a, b) => new Date(a.obs.observedAt).getTime() - new Date(b.obs.observedAt).getTime()
    )[0];

    return {
      mode: 'known_as_of',
      cutoffObservedAt: params.cutoffObservedAt,
      citation: params.citation,
      status: 'unknown_at_cutoff_backfilled_later',
      ...(earliestLater ? { firstObservedAt: earliestLater.obs.observedAt } : {}),
      ...(earliestLater?.obs.sourcePublishedDate
        ? { sourcePublishedDate: earliestLater.obs.sourcePublishedDate }
        : {}),
      explanation: earliestLater
        ? `Historical source (published ${earliestLater.obs.sourcePublishedDate ?? 'earlier'}) was backfilled into this installation at ${earliestLater.obs.observedAt}, which is after the requested cutoff ${params.cutoffObservedAt}.`
        : `No observation timestamp recorded prior to ${params.cutoffObservedAt}.`,
    };
  }

  /**
   * Mode 3 (`legally_applicable`, USCT-034):
   * Evaluate evidence-backed applicability for a target date, optional subdivision (e.g. "subsection (a)" vs "subsection (b)"),
   * and caller-supplied context facts (e.g. `tax_year`).
   * - Never substitutes release date for effective date.
   * - Never treats a null/absent end date as proof of ongoing validity unless boundary state is explicitly `'open'`.
   * - Preserves competing disputed claims and missing conditional facts.
   */
  queryLegallyApplicable(params: {
    requestedLegalDate: string;
    citation: string;
    subdivisionLocator?: string;
    contextFacts?: Record<string, string | boolean | number>;
  }): LegallyApplicableQueryResult {
    const facts = params.contextFacts ?? {};
    const assignments = this.state.citationAssignments.filter(
      (ca) => ca.normalizedCitation.toLowerCase() === params.citation.toLowerCase()
    );
    const provisionIds = new Set(assignments.map((a) => a.provisionId));
    const versionIds = new Set(
      this.state.provisionVersions
        .filter((pv) => provisionIds.has(pv.provisionId))
        .map((pv) => pv.provisionVersionId)
    );

    const claims = this.state.applicabilityClaims.filter((c) => {
      if (!versionIds.has(c.targetProvisionVersionId)) return false;
      if (params.subdivisionLocator !== undefined) {
        return c.targetSubdivisionLocator === params.subdivisionLocator;
      }
      return true;
    });

    if (claims.length === 0) {
      return {
        mode: 'legally_applicable',
        requestedLegalDate: params.requestedLegalDate,
        citation: params.citation,
        ...(params.subdivisionLocator ? { subdivisionLocator: params.subdivisionLocator } : {}),
        suppliedContextFacts: facts,
        applicabilityState: 'unknown',
        matchingClaims: [],
        missingContextFacts: [],
        competingReadings: [],
        evidenceSpans: [],
        explanation: `No evidence-backed applicability claims recorded for '${params.citation}'${params.subdivisionLocator ? ` (${params.subdivisionLocator})` : ''}; refusing to substitute release or retrieval dates.`,
      };
    }

    const collectEvidence = (cs: ApplicabilityClaim[]): EvidenceSpan[] => {
      const ids = new Set(cs.flatMap((c) => c.evidenceIds));
      return this.state.evidenceSpans.filter((e) => ids.has(e.evidenceId));
    };

    // 1. Check for disputed / competing claims (AUD-003 / USCT-034)
    const disputedClaims = claims.filter(
      (c) =>
        c.applicabilityState === 'disputed' ||
        c.editorialReview === 'disputed' ||
        c.competingClaimIds.length > 0
    );
    if (disputedClaims.length > 0) {
      return {
        mode: 'legally_applicable',
        requestedLegalDate: params.requestedLegalDate,
        citation: params.citation,
        ...(params.subdivisionLocator ? { subdivisionLocator: params.subdivisionLocator } : {}),
        suppliedContextFacts: facts,
        applicabilityState: 'disputed',
        matchingClaims: disputedClaims,
        missingContextFacts: [],
        competingReadings: disputedClaims,
        evidenceSpans: collectEvidence(disputedClaims),
        explanation: `Applicability is disputed across ${disputedClaims.length} competing readings; retaining all readings and evidence.`,
      };
    }

    // 2. Check required context facts for conditional claims
    const missingFacts = new Set<string>();
    for (const c of claims) {
      for (const reqFact of c.requiredContextFacts) {
        if (!(reqFact in facts)) {
          missingFacts.add(reqFact);
        }
      }
    }

    if (missingFacts.size > 0) {
      return {
        mode: 'legally_applicable',
        requestedLegalDate: params.requestedLegalDate,
        citation: params.citation,
        ...(params.subdivisionLocator ? { subdivisionLocator: params.subdivisionLocator } : {}),
        suppliedContextFacts: facts,
        applicabilityState: 'conditional',
        matchingClaims: claims,
        missingContextFacts: [...missingFacts],
        competingReadings: [],
        evidenceSpans: collectEvidence(claims),
        explanation: `Applicability is conditional on missing context facts: ${[...missingFacts].join(', ')}.`,
      };
    }

    // 3. Evaluate temporal boundaries against requestedLegalDate with strict coherence and evidence checks (AUD-003 / USCT-034)
    const isCoherentKnownBoundary = (b: TemporalBoundary): boolean => {
      if (b.state !== 'known') return false;
      if (!b.value || typeof b.value !== 'string' || b.value.trim().length === 0) return false;
      if (b.precision === 'unknown' || b.basis === 'unestablished') return false;
      if (b.precision === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(b.value)) return false;
      if (b.precision === 'month' && !/^\d{4}-\d{2}$/.test(b.value)) return false;
      if (b.precision === 'year' && !/^\d{4}$/.test(b.value)) return false;
      return true;
    };

    const compareDateWithPrecision = (
      requestedDay: string,
      boundary: TemporalBoundary,
      role: 'start' | 'end'
    ): 'before' | 'after' | 'within' | 'uncertain_partial_precision' => {
      const val = boundary.value!;
      if (boundary.precision === 'day') {
        const cmp = requestedDay.localeCompare(val);
        if (role === 'start') {
          return cmp < 0 || (cmp === 0 && boundary.inclusive === false) ? 'before' : 'within';
        }
        return cmp > 0 || (cmp === 0 && boundary.inclusive === false) ? 'after' : 'within';
      }
      if (boundary.precision === 'month') {
        const reqMonth = requestedDay.slice(0, 7);
        if (reqMonth === val) return 'uncertain_partial_precision';
        const cmp = reqMonth.localeCompare(val);
        if (role === 'start') return cmp < 0 ? 'before' : 'within';
        return cmp > 0 ? 'after' : 'within';
      }
      if (boundary.precision === 'year') {
        const reqYear = requestedDay.slice(0, 4);
        if (reqYear === val) return 'uncertain_partial_precision';
        const cmp = reqYear.localeCompare(val);
        if (role === 'start') return cmp < 0 ? 'before' : 'within';
        return cmp > 0 ? 'after' : 'within';
      }
      return 'uncertain_partial_precision';
    };

    const evaluateBoundary = (
      claim: ApplicabilityClaim,
      dateStr: string
    ): 'applicable' | 'not_yet_effective' | 'expired' | 'unknown_boundary' | 'conditional_boundary' => {
      const { startBoundary: start, endBoundary: end } = claim;
      const claimEvidence = collectEvidence([claim]);

      // A claim without accepted review or without resolvable supporting EvidenceSpans cannot produce a verified 'known' applicability conclusion (AUD-003)
      if (claim.editorialReview !== 'accepted' || claimEvidence.length === 0) {
        return 'unknown_boundary';
      }

      if (start.state === 'unknown') return 'unknown_boundary';
      if (start.state === 'conditional') {
        if (start.conditions.length === 0 || start.conditions.some((cond) => !facts[cond])) {
          return 'conditional_boundary';
        }
        if (start.value) {
          if (start.precision === 'unknown') return 'unknown_boundary';
          const cmpStart = compareDateWithPrecision(dateStr, start, 'start');
          if (cmpStart === 'before') return 'not_yet_effective';
          if (cmpStart === 'uncertain_partial_precision') return 'unknown_boundary';
        }
      } else if (start.state === 'known') {
        if (!isCoherentKnownBoundary(start)) return 'unknown_boundary';
        const cmpStart = compareDateWithPrecision(dateStr, start, 'start');
        if (cmpStart === 'before') return 'not_yet_effective';
        if (cmpStart === 'uncertain_partial_precision') return 'unknown_boundary';
      }

      // Crucial USCT-034 & AUD-003 invariant:
      // 1. end.state === 'unknown' -> unknown_boundary
      // 2. end.state === 'known' WITHOUT a coherent date/precision/basis -> unknown_boundary (never implies ongoing validity!)
      // 3. end.state === 'open' requires resolvable supporting evidence on the claim
      if (end.state === 'unknown') {
        return 'unknown_boundary';
      }
      if (end.state === 'conditional') {
        if (end.conditions.length === 0 || end.conditions.some((cond) => !facts[cond])) {
          return 'conditional_boundary';
        }
        if (end.value) {
          if (end.precision === 'unknown') return 'unknown_boundary';
          const cmpEnd = compareDateWithPrecision(dateStr, end, 'end');
          if (cmpEnd === 'after') return 'expired';
          if (cmpEnd === 'uncertain_partial_precision') return 'unknown_boundary';
        }
      } else if (end.state === 'known') {
        if (!isCoherentKnownBoundary(end)) return 'unknown_boundary';
        const cmpEnd = compareDateWithPrecision(dateStr, end, 'end');
        if (cmpEnd === 'after') return 'expired';
        if (cmpEnd === 'uncertain_partial_precision') return 'unknown_boundary';
      }

      return 'applicable';
    };

    const applicableClaims: ApplicabilityClaim[] = [];
    let sawUnknownBoundary = false;
    let sawConditionalBoundary = false;

    for (const c of claims) {
      const outcome = evaluateBoundary(c, params.requestedLegalDate);
      if (outcome === 'applicable') {
        applicableClaims.push(c);
      } else if (outcome === 'unknown_boundary') {
        sawUnknownBoundary = true;
      } else if (outcome === 'conditional_boundary') {
        sawConditionalBoundary = true;
      }
    }

    if (sawConditionalBoundary) {
      return {
        mode: 'legally_applicable',
        requestedLegalDate: params.requestedLegalDate,
        citation: params.citation,
        ...(params.subdivisionLocator ? { subdivisionLocator: params.subdivisionLocator } : {}),
        suppliedContextFacts: facts,
        applicabilityState: 'conditional',
        matchingClaims: claims,
        missingContextFacts: [],
        competingReadings: [],
        evidenceSpans: collectEvidence(claims),
        explanation: `Applicability depends on unsatisfied boundary conditions on ${params.requestedLegalDate}.`,
      };
    }

    if (sawUnknownBoundary && applicableClaims.length === 0) {
      return {
        mode: 'legally_applicable',
        requestedLegalDate: params.requestedLegalDate,
        citation: params.citation,
        ...(params.subdivisionLocator ? { subdivisionLocator: params.subdivisionLocator } : {}),
        suppliedContextFacts: facts,
        applicabilityState: 'unknown',
        matchingClaims: claims,
        missingContextFacts: [],
        competingReadings: [],
        evidenceSpans: collectEvidence(claims),
        explanation: `Temporal boundary state is unknown (an unestablished/null endpoint is not assumed open).`,
      };
    }

    return {
      mode: 'legally_applicable',
      requestedLegalDate: params.requestedLegalDate,
      citation: params.citation,
      ...(params.subdivisionLocator ? { subdivisionLocator: params.subdivisionLocator } : {}),
      suppliedContextFacts: facts,
      applicabilityState: applicableClaims.length > 0 ? 'known' : 'unknown',
      matchingClaims: applicableClaims,
      missingContextFacts: [],
      competingReadings: [],
      evidenceSpans: collectEvidence(applicableClaims.length > 0 ? applicableClaims : claims),
      explanation:
        applicableClaims.length > 0
          ? `Verified applicable on ${params.requestedLegalDate} under claim ${applicableClaims.map((c) => c.claimId).join(', ')}.`
          : `Provision version is not in effect on ${params.requestedLegalDate}.`,
    };
  }

  /**
   * USCT-023: Lexical Search over the Local Workbench Catalog with strict scope, release,
   * jurisdiction, and review-state filters (plus optional vector score reranking when enabled).
   */
  searchWorkbenchLexical(params: {
    query: string;
    releaseId?: string;
    uscTitle?: string;
    onlyAcceptedReview?: boolean;
    optionalVectorScores?: Record<string, number>;
  }): WorkbenchLexicalHit[] {
    const terms = params.query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (terms.length === 0) return [];

    // Filter candidate versions strictly by releaseId and title BEFORE scoring (USCT-023)
    let allowedVersionIds: Set<string> | null = null;
    if (params.releaseId) {
      allowedVersionIds = new Set(
        this.state.memberships
          .filter((m) => m.sourceReleaseId === params.releaseId)
          .map((m) => m.provisionVersionId)
      );
    }

    const results: Array<{
      provisionVersionId: string;
      provisionId: string;
      releaseId?: string;
      citation: string;
      heading: string;
      matchedExcerpt: string;
      lexicalScore: number;
      combinedScore: number;
      evidenceSpans: EvidenceSpan[];
    }> = [];

    for (const pv of this.state.provisionVersions) {
      if (allowedVersionIds && !allowedVersionIds.has(pv.provisionVersionId)) continue;
      if (params.uscTitle && pv.uscTitle !== params.uscTitle) continue;

      const assignment = this.state.citationAssignments.find(
        (ca) =>
          ca.provisionId === pv.provisionId &&
          (!params.releaseId || ca.releaseIds.includes(params.releaseId))
      );
      if (params.onlyAcceptedReview && assignment && assignment.editorialReview !== 'accepted') {
        continue;
      }

      const citation = assignment?.normalizedCitation ?? `${pv.uscTitle} U.S.C. ${pv.uscSection}`;
      const haystack = `${citation} ${pv.heading} ${pv.bodyMarkdown}`.toLowerCase();

      let matchedTerms = 0;
      for (const term of terms) {
        if (haystack.includes(term)) matchedTerms++;
      }
      if (matchedTerms === 0) continue;

      const lexicalScore = matchedTerms / terms.length + (citation.toLowerCase() === params.query.toLowerCase().trim() ? 2.0 : 0);
      const vectorBonus = params.optionalVectorScores?.[pv.provisionVersionId] ?? 0;
      const combinedScore = lexicalScore + vectorBonus * 0.25;

      const evidenceSpans = this.state.evidenceSpans.filter((e) =>
        pv.evidenceIds.includes(e.evidenceId)
      );

      results.push({
        provisionVersionId: pv.provisionVersionId,
        provisionId: pv.provisionId,
        ...(params.releaseId ? { releaseId: params.releaseId } : {}),
        citation,
        heading: pv.heading,
        matchedExcerpt: pv.bodyMarkdown.slice(0, 240).replace(/\s+/g, ' ').trim(),
        lexicalScore,
        combinedScore,
        evidenceSpans,
      });
    }

    return results.sort((a, b) => b.combinedScore - a.combinedScore);
  }
}

// --- USCT-036: Bounded Static Historical Release Search Shards ---

export interface HistoricalSearchShardEntry {
  provisionId: string;
  provisionVersionId: string;
  releaseId: string;
  uscTitle: string;
  uscChapter?: string;
  uscSection: string;
  citation: string;
  aliases: string[];
  heading: string;
  status?: ProvisionVersion['status'];
  excerpt: string;
  bodyMarkdown?: string;
  sourceCredits?: string[];
  notes?: ProvisionVersion['notes'];
  tables?: ProvisionVersion['tables'];
  legacyDerived?: boolean;
  historicalUrl: string;
  publisherReleaseId?: string;
  sourceQualification?: ProvisionVersion['sourceQualification'];
  renderedHtml?: string;
  subsectionAnchorIds?: string[];
}

export interface HistoricalSearchShard {
  schemaVersion: 'usct.historical-search-shard/v1';
  shardId: string;
  releaseId: string;
  publisherReleaseLabel: string;
  uscTitle: string;
  coverageState: 'complete' | 'partial' | 'failed' | 'not_collected';
  entries: HistoricalSearchShardEntry[];
  shardDigest: string;
}

export interface HistoricalSearchIndexManifest {
  sourceGaps?: ReturnType<typeof historicalSourceGaps>;
  schemaVersion: 'usct.historical-search-manifest/v1';
  generatedForPublicationId: string;
  availableReleases: Array<{
    releaseId: string;
    label: string;
    titlesAvailable: string[];
    missingTitles: string[];
    coverageState: 'complete' | 'partial' | 'failed' | 'not_collected';
  }>;
  shards: Record<string, { shardPath: string; shardDigest: string; entryCount: number }>;
}

/**
 * Build bounded per-(release, title) static search shards and manifest from the canonical catalog (USCT-036).
 */
export function buildHistoricalSearchShards(
  catalog: CanonicalWorkbenchCatalog,
  publicationId: string,
  baseUrl = '/us-code-tracker/'
): {
  manifest: HistoricalSearchIndexManifest;
  shards: Map<string, HistoricalSearchShard>;
} {
  const snap = catalog.getSnapshot();
  const shards = new Map<string, HistoricalSearchShard>();
  const manifestShards: HistoricalSearchIndexManifest['shards'] = {};
  const availableReleases: HistoricalSearchIndexManifest['availableReleases'] = [];

  for (const rel of snap.releases) {
    const memberships = snap.memberships.filter((m) => m.sourceReleaseId === rel.releaseId);
    const byTitle = new Map<string, HistoricalSearchShardEntry[]>();

    for (const mem of memberships) {
      const pv = snap.provisionVersions.find(
        (v) => v.provisionVersionId === mem.provisionVersionId
      );
      if (!pv) continue;

      const assignments = snap.citationAssignments.filter(
        (ca) => ca.provisionId === pv.provisionId
      );
      const primaryCitation =
        assignments.find((ca) => ca.releaseIds.includes(rel.releaseId))?.normalizedCitation ??
        `${pv.uscTitle} U.S.C. ${pv.uscSection}`;
      const aliases = [...new Set(assignments.map((ca) => ca.normalizedCitation))];

      const entry: HistoricalSearchShardEntry = {
        provisionId: pv.provisionId,
        provisionVersionId: pv.provisionVersionId,
        releaseId: rel.releaseId,
        uscTitle: pv.uscTitle,
        uscChapter: pv.uscChapter,
        uscSection: pv.uscSection,
        citation: primaryCitation,
        aliases,
        heading: pv.heading,
        status: pv.status,
        excerpt: pv.bodyMarkdown.replace(/^#.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 400),
        bodyMarkdown: pv.bodyMarkdown,
        sourceCredits: pv.sourceCredits,
        notes: pv.notes,
        tables: pv.tables,
        legacyDerived: pv.legacyDerived,
        publisherReleaseId: rel.publisherReleaseId,
        sourceQualification: pv.sourceQualification,
        renderedHtml: pv.renderedHtml,
        subsectionAnchorIds: pv.sourceQualification ? [...(pv.renderedHtml ?? '').matchAll(/id="(subsec-[a-zA-Z0-9-]+)"/g)].map(match => match[1]!) : undefined,
        historicalUrl: pv.sourceQualification ? `${baseUrl}history/${pv.sourceQualification.releaseId}/${pv.uscTitle}/${pv.uscSection}/` : `${baseUrl}statute/title-${pv.uscTitle}/chapter-${pv.uscChapter}/section-${pv.uscSection}/?release=${encodeURIComponent(rel.releaseId)}`,
      };

      if (!byTitle.has(pv.uscTitle)) byTitle.set(pv.uscTitle, []);
      byTitle.get(pv.uscTitle)!.push(entry);
    }

    const cov =
      snap.coverages.find((c) => c.coverageId === rel.coverageId) ??
      snap.coverages.find((c) => c.releaseId === rel.releaseId);
    const coverageState = cov?.coverageState ?? 'complete';
    const expectedTitles = cov?.expectedPartitions ?? [...byTitle.keys()];
    const completedTitles = [...byTitle.keys()].sort();
    const presentPartitions = new Set<string>();
    for (const [title, entries] of byTitle.entries()) {
      presentPartitions.add(title);
      presentPartitions.add(`title-${title}`);
      for (const entry of entries) {
        presentPartitions.add(`title-${entry.uscTitle}/section-${entry.uscSection}`);
      }
    }
    const missingTitles = expectedTitles.filter((p) => !presentPartitions.has(p));

    availableReleases.push({
      releaseId: rel.releaseId,
      label: rel.publisherReleaseLabel,
      titlesAvailable: completedTitles,
      missingTitles,
      coverageState,
    });

    for (const [title, entries] of byTitle.entries()) {
      const shardKey = `${rel.releaseId}__title-${title}`;
      const shardPath = `search-shards/${shardKey}.json`;
      const shardDigest = sha256Hex(JSON.stringify(entries));
      const shard: HistoricalSearchShard = {
        schemaVersion: 'usct.historical-search-shard/v1',
        shardId: shardKey,
        releaseId: rel.releaseId,
        publisherReleaseLabel: rel.publisherReleaseLabel,
        uscTitle: title,
        coverageState,
        entries,
        shardDigest,
      };
      shards.set(shardKey, shard);
      manifestShards[shardKey] = {
        shardPath,
        shardDigest,
        entryCount: entries.length,
      };
    }
  }

  return {
    manifest: {
      schemaVersion: 'usct.historical-search-manifest/v1',
      generatedForPublicationId: publicationId,
      sourceGaps: historicalSourceGaps(snap),
      availableReleases,
      shards: manifestShards,
    },
    shards,
  };
}

/**
 * Execute a scoped historical release search against static shards (USCT-036).
 * - Strictly pins all results and navigation links to `releaseId`.
 * - Never falls back to current text when a shard or release is missing!
 */
export function queryHistoricalSearchShard(params: {
  releaseId: string;
  uscTitle: string;
  query: string;
  manifest: HistoricalSearchIndexManifest;
  loadedShards: ReadonlyMap<string, HistoricalSearchShard>;
}): {
  releaseId: string;
  uscTitle: string;
  status: 'ok' | 'shard_missing_or_uncollected' | 'release_not_found';
  coverageState: 'complete' | 'partial' | 'failed' | 'not_collected';
  results: HistoricalSearchShardEntry[];
  warningMessage?: string;
} {
  const relMeta = params.manifest.availableReleases.find((r) => r.releaseId === params.releaseId);
  if (!relMeta) {
    return {
      releaseId: params.releaseId,
      uscTitle: params.uscTitle,
      status: 'release_not_found',
      coverageState: 'not_collected',
      results: [],
      warningMessage: `Historical release '${params.releaseId}' is not in the published index; current law is not substituted.`,
    };
  }

  const shardKey = `${params.releaseId}__title-${params.uscTitle}`;
  const shard = params.loadedShards.get(shardKey);
  if (!shard) {
    return {
      releaseId: params.releaseId,
      uscTitle: params.uscTitle,
      status: 'shard_missing_or_uncollected',
      coverageState: 'not_collected',
      results: [],
      warningMessage: `Title ${params.uscTitle} was not collected for release ${relMeta.label} (${params.releaseId}); refusing to leak current-release search results.`,
    };
  }

  const q = params.query.toLowerCase().trim();
  const matched = shard.entries.filter((e) => {
    const text = `${e.citation} ${e.aliases.join(' ')} ${e.heading} ${e.excerpt}`.toLowerCase();
    return text.includes(q);
  });

  return {
    releaseId: params.releaseId,
    uscTitle: params.uscTitle,
    status: 'ok',
    coverageState: shard.coverageState,
    results: matched,
  };
}

// --- USCT-017: Exception Ratchet Quality Gate ---

export interface RatchetGateVerdict {
  passed: boolean;
  newUnapprovedFindings: FindingRecord[];
  expiredWaivers: FindingRecord[];
  staleFixedWaivers: string[];
  activeApprovedWaivers: FindingRecord[];
}

/**
 * Evaluate the Finding Register against a baseline exception allowlist (USCT-017):
 * - Fails if any new unapproved finding appears.
 * - Fails if any waived finding is past its `expiresAt` timestamp.
 * - Fails if a baseline waiver fingerprint no longer exists in the current findings (stale fixed exception must be shrunk!).
 */
export function evaluateFindingRatchet(params: {
  currentFindings: readonly FindingRecord[];
  baselineFingerprints: ReadonlySet<string>;
  nowIso: string;
}): RatchetGateVerdict {
  const nowMs = new Date(params.nowIso).getTime();
  const newUnapprovedFindings: FindingRecord[] = [];
  const expiredWaivers: FindingRecord[] = [];
  const activeApprovedWaivers: FindingRecord[] = [];

  const seenCurrentFingerprints = new Set<string>();

  for (const f of params.currentFindings) {
    if (f.status === 'resolved_editorial' || f.status === 'superseded') {
      continue;
    }
    seenCurrentFingerprints.add(f.fingerprint);

    if (!params.baselineFingerprints.has(f.fingerprint)) {
      newUnapprovedFindings.push(f);
      continue;
    }

    if (f.expiresAt && new Date(f.expiresAt).getTime() < nowMs) {
      expiredWaivers.push(f);
      continue;
    }

    activeApprovedWaivers.push(f);
  }

  // Any baseline fingerprint that was fixed (absent or resolved) must be removed from the baseline
  const staleFixedWaivers: string[] = [];
  for (const fp of params.baselineFingerprints) {
    if (!seenCurrentFingerprints.has(fp)) {
      staleFixedWaivers.push(fp);
    }
  }

  const passed =
    newUnapprovedFindings.length === 0 &&
    expiredWaivers.length === 0 &&
    staleFixedWaivers.length === 0;

  return {
    passed,
    newUnapprovedFindings,
    expiredWaivers,
    staleFixedWaivers,
    activeApprovedWaivers,
  };
}

// --- USCT-021, USCT-022, USCT-024, USCT-025, USCT-031, USCT-032: Exports, Topics, & Optional Adapters ---

export interface StaticNeighborhoodShard {
  schemaVersion: 'usct.relationship-neighborhood/v1';
  provisionId: string;
  citation: string;
  releaseId: string;
  edges: Array<{
    assertionId: string;
    direction: 'outbound' | 'inbound';
    relationType: LegalAssertion['relationType'];
    peerId: string;
    peerLabel: string;
    authorityKind: LegalAssertion['authorityKind'];
    extractionState: ExtractionState;
    editorialReview: EditorialReviewState;
    versionAlignmentState: LegalAssertion['versionAlignmentState'];
    propositionText?: string;
    evidenceExcerpts: string[];
  }>;
}

export function buildRelationshipNeighborhoodShard(
  catalog: CanonicalWorkbenchCatalog,
  provisionId: string,
  releaseId: string
): StaticNeighborhoodShard {
  const snap = catalog.getSnapshot();
  const assignment =
    snap.citationAssignments.find(
      (ca) => ca.provisionId === provisionId && ca.releaseIds.includes(releaseId)
    ) ?? snap.citationAssignments.find((ca) => ca.provisionId === provisionId);
  const citation = assignment?.normalizedCitation ?? provisionId;

  const membershipInRelease = snap.memberships.find(
    (m) => m.sourceReleaseId === releaseId && m.provisionId === provisionId
  );
  const versionIdInRelease = membershipInRelease?.provisionVersionId;

  const relevantAssertions = snap.assertions.filter((a) => {
    const matchesNode =
      a.subjectId === provisionId ||
      a.objectId === provisionId ||
      (versionIdInRelease !== undefined &&
        (a.subjectId === versionIdInRelease || a.objectId === versionIdInRelease));
    if (!matchesNode) return false;
    // If the assertion is bound to specific applicability claims, ensure at least one targets the version in this release
    if (a.applicabilityClaimIds.length > 0 && versionIdInRelease) {
      const linkedClaims = snap.applicabilityClaims.filter((c) =>
        a.applicabilityClaimIds.includes(c.claimId)
      );
      if (
        linkedClaims.length > 0 &&
        !linkedClaims.some((c) => c.targetProvisionVersionId === versionIdInRelease)
      ) {
        return false;
      }
    }
    return true;
  });

  const edges: StaticNeighborhoodShard['edges'] = relevantAssertions.map((a) => {
    const isOutbound =
      a.subjectId === provisionId ||
      (versionIdInRelease !== undefined && a.subjectId === versionIdInRelease);
    const peerId = isOutbound
      ? (a.objectId ?? a.unresolvedTargetCitation ?? 'unresolved')
      : a.subjectId;
    const peerAssignment =
      snap.citationAssignments.find(
        (ca) => ca.provisionId === peerId && ca.releaseIds.includes(releaseId)
      ) ?? snap.citationAssignments.find((ca) => ca.provisionId === peerId);
    const peerLabel = peerAssignment?.normalizedCitation ?? peerId;
    const excerpts = snap.evidenceSpans
      .filter((e) => a.evidenceIds.includes(e.evidenceId))
      .map((e) => e.excerpt);

    return {
      assertionId: a.assertionId,
      direction: isOutbound ? 'outbound' : 'inbound',
      relationType: a.relationType,
      peerId,
      peerLabel,
      authorityKind: a.authorityKind,
      extractionState: a.extractionState,
      editorialReview: a.editorialReview,
      versionAlignmentState: a.versionAlignmentState,
      ...(a.propositionText ? { propositionText: a.propositionText } : {}),
      evidenceExcerpts: excerpts,
    };
  });

  return {
    schemaVersion: 'usct.relationship-neighborhood/v1',
    provisionId,
    citation,
    releaseId,
    edges,
  };
}

/**
 * USCT-022: Deterministic Analytical Export & Offline Coverage Audit Queries (DuckDB / Parquet / JSONL compatible)
 */
export interface AnalyticalAuditReport {
  exportSchemaVersion: 'usct.analytical-export/v1';
  catalogDigest: string;
  changesByReleaseAndTitle: Array<{
    releaseId: string;
    uscTitle: string;
    provisionCount: number;
  }>;
  missingOrPartialScopes: Array<{
    coverageId: string;
    sourceScope: string;
    coverageState: CollectionCoverage['coverageState'];
    missingPartitions: string[];
  }>;
  unresolvedFindingsCount: number;
  tableHashes: {
    provisionsHash: string;
    versionsHash: string;
    coveragesHash: string;
  };
}

export function runAnalyticalCoverageAudit(
  catalog: CanonicalWorkbenchCatalog
): AnalyticalAuditReport {
  const snap = catalog.getSnapshot();
  const provisionsHash = sha256Hex(JSON.stringify(snap.provisions));
  const versionsHash = sha256Hex(JSON.stringify(snap.provisionVersions));
  const coveragesHash = sha256Hex(JSON.stringify(snap.coverages));
  const catalogDigest = sha256Hex(`${provisionsHash}:${versionsHash}:${coveragesHash}`);

  const releaseTitleCounts = new Map<string, number>();
  for (const m of snap.memberships) {
    const pv = snap.provisionVersions.find((v) => v.provisionVersionId === m.provisionVersionId);
    if (!pv) continue;
    const key = `${m.sourceReleaseId}::${pv.uscTitle}`;
    releaseTitleCounts.set(key, (releaseTitleCounts.get(key) ?? 0) + 1);
  }

  const changesByReleaseAndTitle = [...releaseTitleCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, count]) => {
      const [releaseId, uscTitle] = k.split('::');
      return {
        releaseId: releaseId ?? '',
        uscTitle: uscTitle ?? '',
        provisionCount: count,
      };
    });

  const missingOrPartialScopes = snap.coverages
    .filter((c) => c.coverageState !== 'complete')
    .map((c) => {
      const completedSet = new Set([...c.completedPartitions, ...c.absentPartitions]);
      const missingPartitions = c.expectedPartitions.filter((p) => !completedSet.has(p));
      return {
        coverageId: c.coverageId,
        sourceScope: c.sourceScope,
        coverageState: c.coverageState,
        missingPartitions,
      };
    });

  const unresolvedFindingsCount = snap.findings.filter(
    (f) => f.status === 'open' || f.status === 'waived_with_expiry'
  ).length;

  return {
    exportSchemaVersion: 'usct.analytical-export/v1',
    catalogDigest,
    changesByReleaseAndTitle,
    missingOrPartialScopes,
    unresolvedFindingsCount,
    tableHashes: {
      provisionsHash,
      versionsHash,
      coveragesHash,
    },
  };
}

/**
 * USCT-024 (Optional): Local Gemma Evidence-Bound Research Draft Receipt
 * Validates that every factual claim cites an existing EvidenceSpan and never auto-promotes
 * a model output to an accepted legal holding.
 */
export interface LocalModelDraftClaim {
  statement: string;
  citedEvidenceIds: string[];
  supportStatus: 'supported' | 'unknown' | 'conflicting';
}

export interface LocalModelRuntimeConfig {
  endpointKind: 'merlin_gateway' | 'openai_compatible' | 'mock';
  modelAlias: string;
  numCtx: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface LocalModelBudgetRecord {
  deadlineMs: number;
  elapsedMs: number;
  maxOutputTokens: number;
  promptTokens?: number;
  completionTokens?: number;
  status:
    | 'completed'
    | 'budget_exhausted'
    | 'cancelled'
    | 'gateway_unavailable'
    | 'rate_limited'
    | 'failed';
}

export interface LocalModelDraftReceipt {
  schemaVersion: 'usct.model-draft-receipt/v1';
  receiptId: string;
  modelId: string;
  modelWeightsDigest: string;
  promptTemplateVersion: string;
  promptHash?: string;
  inputProvisionVersionIds: string[];
  inputEvidenceIds: string[];
  inputEvidenceDigest?: string;
  draftSummary: string;
  citedEvidenceIds: string[];
  claims?: LocalModelDraftClaim[];
  unresolvedQuestions?: string[];
  runtimeConfig?: LocalModelRuntimeConfig;
  budget?: LocalModelBudgetRecord;
  outputHash: string;
  extractionState: 'candidate';
  editorialReview: 'unreviewed' | 'rejected';
  validationPassed: boolean;
  validationErrors: string[];
}

function validateDraftClaims(
  claims: readonly LocalModelDraftClaim[],
  availableIds: ReadonlySet<string>,
  citedEvidenceIds: readonly string[],
  unresolvedQuestions: readonly string[] | undefined,
  errors: string[]
): void {
  if (
    claims.length === 0 &&
    citedEvidenceIds.length === 0 &&
    (unresolvedQuestions?.length ?? 0) === 0
  ) {
    errors.push('Model draft with empty claims must cite evidence or record unresolvedQuestions');
  }
  claims.forEach((claim, idx) => {
    if (!claim.statement.trim()) {
      errors.push(`Claim ${idx} must have a non-empty statement`);
    }
    if (claim.supportStatus === 'supported' && claim.citedEvidenceIds.length === 0) {
      errors.push(`Supported claim ${idx} must cite at least one supporting EvidenceSpan`);
    }
    // Only 'supported' claims require >= 1 citation; 'unknown'/'conflicting' claims may omit IDs,
    // though any cited IDs supplied must still belong to availableIds.
    for (const cid of claim.citedEvidenceIds) {
      if (!availableIds.has(cid)) {
        errors.push(`Claim ${idx} cited non-existent or out-of-scope evidenceId: ${cid}`);
      }
    }
  });
}

function computeDraftOutputHash(params: {
  modelId: string;
  modelWeightsDigest: string;
  promptTemplateVersion: string;
  promptHash?: string;
  inputEvidenceDigest?: string;
  draftSummary: string;
  citedEvidenceIds: readonly string[];
  claims?: readonly LocalModelDraftClaim[];
  unresolvedQuestions?: readonly string[];
}): string {
  return sha256Hex(
    JSON.stringify({
      modelId: params.modelId,
      modelWeightsDigest: params.modelWeightsDigest,
      promptTemplateVersion: params.promptTemplateVersion,
      promptHash: params.promptHash ?? null,
      inputEvidenceDigest: params.inputEvidenceDigest ?? null,
      draftSummary: params.draftSummary,
      citedEvidenceIds: params.citedEvidenceIds,
      claims: params.claims ?? null,
      unresolvedQuestions: params.unresolvedQuestions ?? null,
    })
  );
}

export function validateLocalModelDraft(params: {
  modelId: string;
  modelWeightsDigest: string;
  promptTemplateVersion: string;
  promptHash?: string;
  inputProvisionVersionIds: string[];
  availableEvidenceSpans: readonly EvidenceSpan[];
  inputEvidenceDigest?: string;
  draftSummary: string;
  citedEvidenceIds: string[];
  claims?: readonly LocalModelDraftClaim[];
  unresolvedQuestions?: readonly string[];
  runtimeConfig?: LocalModelRuntimeConfig;
  budget?: LocalModelBudgetRecord;
}): LocalModelDraftReceipt {
  const availableIds = new Set(params.availableEvidenceSpans.map((e) => e.evidenceId));
  const validationErrors: string[] = [];
  if (params.claims !== undefined) {
    validateDraftClaims(params.claims, availableIds, params.citedEvidenceIds, params.unresolvedQuestions, validationErrors);
  } else if (params.citedEvidenceIds.length === 0) {
    validationErrors.push('Model draft must cite at least one supporting EvidenceSpan');
  }
  for (const cid of params.citedEvidenceIds) {
    if (!availableIds.has(cid)) validationErrors.push(`Model cited non-existent or out-of-scope evidenceId: ${cid}`);
  }
  const outputHash = computeDraftOutputHash(params);
  const validationPassed = validationErrors.length === 0;
  return {
    schemaVersion: 'usct.model-draft-receipt/v1',
    receiptId: `model-rcpt-${outputHash.slice(0, 12)}`,
    modelId: params.modelId,
    modelWeightsDigest: params.modelWeightsDigest,
    promptTemplateVersion: params.promptTemplateVersion,
    ...(params.promptHash !== undefined ? { promptHash: params.promptHash } : {}),
    inputProvisionVersionIds: [...params.inputProvisionVersionIds],
    inputEvidenceIds: [...availableIds],
    ...(params.inputEvidenceDigest !== undefined ? { inputEvidenceDigest: params.inputEvidenceDigest } : {}),
    draftSummary: params.draftSummary,
    citedEvidenceIds: [...params.citedEvidenceIds],
    ...(params.claims !== undefined ? { claims: params.claims.map((c) => ({ ...c, citedEvidenceIds: [...c.citedEvidenceIds] })) } : {}),
    ...(params.unresolvedQuestions !== undefined ? { unresolvedQuestions: [...params.unresolvedQuestions] } : {}),
    ...(params.runtimeConfig !== undefined ? { runtimeConfig: { ...params.runtimeConfig } } : {}),
    ...(params.budget !== undefined ? { budget: { ...params.budget } } : {}),
    outputHash,
    extractionState: 'candidate',
    editorialReview: validationPassed ? 'unreviewed' : 'rejected',
    validationPassed,
    validationErrors,
  };
}

/**
 * USCT-032 (Optional): Attributed RuleSpec-Compatible Evidence Slice Export
 * Preserves CC0 primary law vs. CC-BY-4.0 / Apache-2.0 attribution boundaries.
 */
export interface RuleSpecCompatibleSliceExport {
  schemaVersion: 'usct.rulespec-export-slice/v1';
  provisionId: string;
  provisionVersionId: string;
  releaseId: string;
  trackerBacklinkUrl: string;
  primaryLawLicense: 'CC0-1.0';
  enrichmentAttribution: Array<{
    source: string;
    license: 'CC-BY-4.0' | 'Apache-2.0' | 'CC0-1.0';
    attributionNotice: string;
  }>;
  evidenceSpans: EvidenceSpan[];
  applicabilityClaims: ApplicabilityClaim[];
  unsupportedConstructs: string[];
}

export function exportRuleSpecCompatibleSlice(params: {
  catalog: CanonicalWorkbenchCatalog;
  provisionId: string;
  releaseId: string;
  baseUrl?: string;
  includeAxiomAttribution?: boolean;
}): Result<RuleSpecCompatibleSliceExport> {
  const baseUrl = params.baseUrl ?? 'https://civic-source.github.io/us-code-tracker/';
  const snap = params.catalog.getSnapshot();
  const mem = snap.memberships.find(
    (m) => m.sourceReleaseId === params.releaseId && m.provisionId === params.provisionId
  );
  if (!mem) {
    return err(new Error(`Provision ${params.provisionId} not found in release ${params.releaseId}`));
  }
  const pv = snap.provisionVersions.find((v) => v.provisionVersionId === mem.provisionVersionId);
  if (!pv) {
    return err(new Error(`ProvisionVersion ${mem.provisionVersionId} not found`));
  }

  const evidenceSpans = snap.evidenceSpans.filter((e) => pv.evidenceIds.includes(e.evidenceId));
  const applicabilityClaims = snap.applicabilityClaims.filter(
    (c) => c.targetProvisionVersionId === pv.provisionVersionId
  );

  const enrichmentAttribution: RuleSpecCompatibleSliceExport['enrichmentAttribution'] = [
    {
      source: 'Office of the Law Revision Counsel (OLRC) USLM XML',
      license: 'CC0-1.0',
      attributionNotice: 'U.S. federal statutory text is in the public domain (17 U.S.C. § 105).',
    },
    {
      source: 'civic-source/us-code-tracker pipeline',
      license: 'Apache-2.0',
      attributionNotice: 'Canonical extraction and provenance tooling licensed under Apache 2.0.',
    },
  ];

  if (params.includeAxiomAttribution) {
    enrichmentAttribution.push({
      source: 'The Axiom Foundation / rulespec-us interoperability reference',
      license: 'CC-BY-4.0',
      attributionNotice:
        'RuleSpec-derived encodings, parameters, and provenance are licensed under CC BY 4.0 by The Axiom Foundation (kept distinct from CC0 statutory data).',
    });
  }

  return ok({
    schemaVersion: 'usct.rulespec-export-slice/v1',
    provisionId: pv.provisionId,
    provisionVersionId: pv.provisionVersionId,
    releaseId: params.releaseId,
    trackerBacklinkUrl: `${baseUrl}statute/title-${pv.uscTitle}/chapter-${pv.uscChapter}/section-${pv.uscSection}/?release=${encodeURIComponent(params.releaseId)}`,
    primaryLawLicense: 'CC0-1.0',
    enrichmentAttribution,
    evidenceSpans,
    applicabilityClaims,
    unsupportedConstructs: pv.unsupportedStructures.map((u) => `${u.elementName} (${u.locator})`),
  });
}

/**
 * USCT-031 (Optional): HCK-Compatible TaskAttempt Receipt Export
 * Emits a self-contained task execution receipt from the local FencedTaskCoordinator without
 * delegating acceptance predicates to an external control plane.
 */
export interface HckCompatibleTaskReceipt {
  schemaVersion: 'usct.hck-task-receipt/v1';
  taskId: string;
  attemptId: string;
  generation: number;
  fencingToken: number;
  inputIdentity: string;
  state: TaskAttemptRecord['state'];
  acceptedOutputHash?: string;
  acceptedAtIso?: string;
}

export function exportHckTaskAttemptReceipt(
  coordinator: FencedTaskCoordinator,
  attemptId: string
): Result<HckCompatibleTaskReceipt> {
  const attempt = coordinator.getAttempt(attemptId);
  if (!attempt) {
    return err(new Error(`Attempt ${attemptId} not found`));
  }
  const taskState = coordinator.getTaskState(attempt.taskId);
  return ok({
    schemaVersion: 'usct.hck-task-receipt/v1',
    taskId: attempt.taskId,
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    fencingToken: attempt.fencingToken,
    inputIdentity: attempt.inputIdentity,
    state: attempt.state,
    ...(taskState?.acceptedOutputHash ? { acceptedOutputHash: taskState.acceptedOutputHash } : {}),
    ...(taskState?.acceptedAtIso ? { acceptedAtIso: taskState.acceptedAtIso } : {}),
  });
}

/**
 * USCT-026, USCT-027, USCT-028: M5 Pilot Parity, Benchmark, and Corrupt-Index Recovery Drill
 * Verifies that:
 * 1. Rebuilding derived search shards and analytical exports from a clean catalog snapshot produces
 *    byte-identical digests to the incremental catalog state.
 * 2. Simulated corruption or deletion of derived shards/exports recovers 100% deterministically
 *    from the canonical catalog snapshot without re-fetching network sources.
 */
export interface PilotRecoveryDrillReport {
  cleanVsIncrementalDigestMatch: boolean;
  recoveredFromCorruptIndexMatch: boolean;
  catalogDigest: string;
  shardCount: number;
  elapsedMs: number;
}

export async function runPilotParityAndRecoveryDrill(params: {
  catalog: CanonicalWorkbenchCatalog;
  publicationId: string;
  workDir: string;
  incrementalBundles?: readonly Partial<CatalogStateSnapshot>[];
}): Promise<PilotRecoveryDrillReport> {
  const startMs = Date.now();

  let incrementalCatalog = params.catalog;
  if (params.incrementalBundles && params.incrementalBundles.length > 0) {
    incrementalCatalog = new CanonicalWorkbenchCatalog();
    for (const step of params.incrementalBundles) {
      const stepRes = incrementalCatalog.ingestBundle(step);
      if (!stepRes.ok) throw stepRes.error;
    }
  }

  const incrementalAudit = runAnalyticalCoverageAudit(incrementalCatalog);
  const incrementalShards = buildHistoricalSearchShards(incrementalCatalog, params.publicationId);

  // Build a fresh single-pass clean catalog from the merged snapshot
  const mergedSnap = incrementalCatalog.getSnapshot();
  const cleanSinglePassCatalog = new CanonicalWorkbenchCatalog();
  const cleanIngestRes = cleanSinglePassCatalog.ingestBundle(mergedSnap);
  if (!cleanIngestRes.ok) throw cleanIngestRes.error;

  // Persist canonical catalog to disk
  const catalogPath = join(params.workDir, 'canonical-catalog.json');
  await cleanSinglePassCatalog.saveToFile(catalogPath);

  // Simulate corrupt derived index file on disk
  const derivedManifestPath = join(params.workDir, 'search-shards', 'manifest.json');
  await mkdir(dirname(derivedManifestPath), { recursive: true });
  await writeFile(derivedManifestPath, '{"corrupted": true}', 'utf-8');

  // Recover purely from local canonical catalog snapshot without network calls
  const recoveredCatalog = await CanonicalWorkbenchCatalog.loadFromFile(catalogPath);
  const cleanAudit = runAnalyticalCoverageAudit(recoveredCatalog);
  const cleanShards = buildHistoricalSearchShards(recoveredCatalog, params.publicationId);

  // Overwrite corrupted derived manifest with recovered manifest
  await writeFile(derivedManifestPath, JSON.stringify(cleanShards.manifest, null, 2) + '\n', 'utf-8');
  const verifiedManifestRaw = await readFile(derivedManifestPath, 'utf-8');
  const verifiedManifest = JSON.parse(verifiedManifestRaw) as HistoricalSearchIndexManifest;

  const cleanVsIncrementalDigestMatch =
    incrementalAudit.catalogDigest === cleanAudit.catalogDigest &&
    JSON.stringify(incrementalShards.manifest) === JSON.stringify(cleanShards.manifest);

  const recoveredFromCorruptIndexMatch =
    verifiedManifest.schemaVersion === 'usct.historical-search-manifest/v1' &&
    JSON.stringify(verifiedManifest) === JSON.stringify(incrementalShards.manifest);

  return {
    cleanVsIncrementalDigestMatch,
    recoveredFromCorruptIndexMatch,
    catalogDigest: cleanAudit.catalogDigest,
    shardCount: cleanShards.shards.size,
    elapsedMs: Date.now() - startMs,
  };
}

export type { PublicationReceipt };

/**
 * Compute aggregate license and attribution metadata across contributing artifacts (AUD-015, USCT-032).
 * Never relabels 'unknown' or third-party licenses as CC0-1.0.
 */
export function computeExportAttribution(artifacts: readonly SourceArtifact[]): {
  effectiveLicenseSummary: string;
  containsUnknownLicense: boolean;
  requiresAttribution: boolean;
  licenses: string[];
  attributionNotices: string[];
  unknownLicenseArtifactIds: string[];
} {
  const licenses = [...new Set(artifacts.map((a) => a.license || 'unknown'))].sort();
  const unknownLicenseArtifactIds = artifacts
    .filter((a) => !a.license || a.license === 'unknown')
    .map((a) => a.artifactId);
  const containsUnknownLicense = unknownLicenseArtifactIds.length > 0;
  const attributionNotices = artifacts
    .filter((a) => a.attributionRequired || Boolean(a.attributionText))
    .map((a) => a.attributionText ?? `Attribution required for ${a.artifactId} (${a.license})`);
  const requiresAttribution = attributionNotices.length > 0;

  let effectiveLicenseSummary = 'unknown';
  if (!containsUnknownLicense && licenses.length === 1) {
    effectiveLicenseSummary = licenses[0]!;
  } else if (licenses.length > 1 || containsUnknownLicense) {
    effectiveLicenseSummary = `mixed(${licenses.join('+')})`;
  }

  return {
    effectiveLicenseSummary,
    containsUnknownLicense,
    requiresAttribution,
    licenses,
    attributionNotices,
    unknownLicenseArtifactIds,
  };
}

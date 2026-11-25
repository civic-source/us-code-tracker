/**
 * USCT-009, USCT-023, USCT-028, USCT-035, AUD-010:
 * Real PostgreSQL 16 Execution Bridge for Canonical Workbench Catalog,
 * Durable TaskAttempt Coordinator, Full-Text Lexical Search, and Backup/Restore Drill.
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { type Result, ok, err } from '@civic-source/types';
import {
  CanonicalWorkbenchCatalog,
  FencedTaskCoordinator,
  type CatalogStateSnapshot,
  type WorkbenchLexicalHit,
} from './workbench-catalog.js';

import { historicalWithdrawalIdentifiers } from './historical-withdrawal.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_POSTGRES_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://usct:usct@127.0.0.1:54329/usct_workbench';

async function runPythonPgScript<T>(script: string, payload: unknown, dbUrl = DEFAULT_POSTGRES_URL): Promise<Result<T>> {
  try {
    const { stdout } = await execFileAsync(
      'python3',
      ['-c', script, dbUrl],
      {
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, PG_PAYLOAD_JSON: JSON.stringify(payload) },
      }
    );
    const parsed = JSON.parse(stdout.trim()) as { ok: boolean; data?: T; error?: string };
    if (!parsed.ok) {
      return err(new Error(parsed.error ?? 'PostgreSQL operation failed'));
    }
    return ok(parsed.data as T);
  } catch (e: unknown) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Apply the full 17-table PostgreSQL DDL migration (15 catalog entity tables + 2 durable task fencing tables).
 */
export async function migratePostgres(
  dbUrl = DEFAULT_POSTGRES_URL,
  options?: { reset?: boolean }
): Promise<Result<{ serverVersion: string; tablesReady: number }>> {
  const ddl = CanonicalWorkbenchCatalog.getPostgresMigrationSql();
  const script = `
import json, os, sys, psycopg2

db_url = sys.argv[1]
payload = json.loads(os.environ["PG_PAYLOAD_JSON"])
conn = psycopg2.connect(db_url)
try:
    with conn:
        with conn.cursor() as cur:
            if payload.get("reset"):
                cur.execute("""
                    DROP TABLE IF EXISTS
                      task_attempts, accepted_tasks, derived_artifacts, findings,
                      collection_coverages, historical_observations, applicability_claims,
                      legal_assertions, evidence_spans, identity_transitions,
                      citation_assignments, snapshot_memberships, provision_versions,
                      provisions, source_releases, source_snapshots, source_artifacts
                    CASCADE;
                """)
            cur.execute(payload["ddl"])
            cur.execute("SELECT version();")
            ver = cur.fetchone()[0]
            cur.execute("""
                SELECT count(*) FROM information_schema.tables
                WHERE table_schema = 'public';
            """)
            tcount = cur.fetchone()[0]
            print(json.dumps({"ok": True, "data": {"serverVersion": ver, "tablesReady": int(tcount)}}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
finally:
    conn.close()
`;
  return runPythonPgScript(script, { ddl, reset: Boolean(options?.reset) }, dbUrl);
}

/**
 * Synchronize all 15 canonical catalog entity collections to a real PostgreSQL database inside a single transaction.
 * Enforces immutable identity conflict rejection inside PostgreSQL: if an existing immutable entity row in PostgreSQL
 * has a different content digest, the transaction aborts and rolls back completely.
 */
export async function syncCatalogToPostgres(
  catalog: CanonicalWorkbenchCatalog,
  dbUrl = DEFAULT_POSTGRES_URL,
  options?: { resetFirst?: boolean }
): Promise<Result<{ tablesWritten: number; rowsUpserted: number }>> {
  const mig = await migratePostgres(dbUrl, { reset: Boolean(options?.resetFirst) });
  if (!mig.ok) return mig;

  const snap = catalog.getSnapshot();
  const script = `
import json, os, sys, psycopg2

db_url = sys.argv[1]
snap = json.loads(os.environ["PG_PAYLOAD_JSON"])
conn = psycopg2.connect(db_url)
rows = 0
try:
    with conn:
        with conn.cursor() as cur:
            for a in snap.get("artifacts", []):
                cur.execute("SELECT sha256, byte_length, media_type FROM source_artifacts WHERE artifact_id = %s", (a["artifactId"],))
                ex = cur.fetchone()
                if ex and (ex[0].strip() != a["sha256"] or int(ex[1]) != int(a["byteLength"]) or ex[2] != a["mediaType"]):
                    raise ValueError(f"Immutable identity collision in PostgreSQL for SourceArtifact '{a['artifactId']}'")
                cur.execute("""
                    INSERT INTO source_artifacts (artifact_id, sha256, byte_length, media_type, storage_locator, license, attribution_required, attribution_text, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (artifact_id) DO NOTHING
                """, (a["artifactId"], a["sha256"], a["byteLength"], a["mediaType"], a["storageLocator"], a.get("license", "unknown"), bool(a.get("attributionRequired", False)), a.get("attributionText"), json.dumps(a)))
                rows += 1

            for s in snap.get("snapshots", []):
                cur.execute("SELECT artifact_id, payload_json FROM source_snapshots WHERE snapshot_id = %s", (s["snapshotId"],))
                ex = cur.fetchone()
                if ex and (ex[0] != s["artifactId"] or ex[1].get("requestedUrl") != s.get("requestedUrl")):
                    raise ValueError(f"Immutable identity collision in PostgreSQL for SourceSnapshot '{s['snapshotId']}'")
                cur.execute("""
                    INSERT INTO source_snapshots (snapshot_id, source_registry_id, artifact_id, authority_kind, retrieved_at, legacy_derived, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (snapshot_id) DO NOTHING
                """, (s["snapshotId"], s["sourceRegistryId"], s["artifactId"], s["authorityKind"], s["retrievedAt"], bool(s.get("legacyDerived", False)), json.dumps(s)))
                rows += 1

            for r in snap.get("releases", []):
                cur.execute("SELECT manifest_digest, release_segment FROM source_releases WHERE release_id = %s", (r["releaseId"],))
                ex = cur.fetchone()
                if ex and (ex[0].strip() != r["manifestDigest"] or ex[1] != r["releaseSegment"]):
                    raise ValueError(f"Immutable identity collision in PostgreSQL for SourceRelease '{r['releaseId']}'")
                cur.execute("""
                    INSERT INTO source_releases (release_id, publisher_release_label, release_segment, congress, law_identifier, manifest_digest, published_date, observed_at, legacy_derived, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (release_id) DO NOTHING
                """, (r["releaseId"], r["publisherReleaseLabel"], r["releaseSegment"], int(r["congress"]), r["lawIdentifier"], r["manifestDigest"], r.get("publishedDate"), r["observedAt"], bool(r.get("legacyDerived", False)), json.dumps(r)))
                rows += 1

            for p in snap.get("provisions", []):
                cur.execute("""
                    INSERT INTO provisions (provision_id, jurisdiction, document_kind, creation_basis, identity_registry_version, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (provision_id) DO UPDATE SET
                      creation_basis = EXCLUDED.creation_basis,
                      identity_registry_version = EXCLUDED.identity_registry_version,
                      payload_json = EXCLUDED.payload_json
                """, (p["provisionId"], p.get("jurisdiction", "US"), p["documentKind"], p["creationBasis"], int(p.get("identityRegistryVersion", 1)), json.dumps(p)))
                rows += 1

            for pv in snap.get("provisionVersions", []):
                cur.execute("SELECT normalized_content_hash, body_markdown, heading, status FROM provision_versions WHERE provision_version_id = %s", (pv["provisionVersionId"],))
                ex = cur.fetchone()
                if ex and (ex[0].strip() != pv["normalizedContentHash"] or ex[1] != pv["bodyMarkdown"] or ex[2] != pv["heading"] or ex[3] != pv["status"]):
                    raise ValueError(f"Immutable identity collision in PostgreSQL for ProvisionVersion '{pv['provisionVersionId']}'")
                cur.execute("""
                    INSERT INTO provision_versions (provision_version_id, provision_id, normalized_content_hash, normalization_version, usc_title, usc_chapter, usc_section, heading, status, body_markdown, legacy_derived, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (provision_version_id) DO NOTHING
                """, (pv["provisionVersionId"], pv["provisionId"], pv["normalizedContentHash"], pv["normalizationVersion"], pv["uscTitle"], pv["uscChapter"], pv["uscSection"], pv["heading"], pv["status"], pv["bodyMarkdown"], bool(pv.get("legacyDerived", False)), json.dumps(pv)))
                rows += 1

            for m in snap.get("memberships", []):
                cur.execute("SELECT source_release_id, provision_version_id, provision_id FROM snapshot_memberships WHERE membership_id = %s", (m["membershipId"],))
                ex = cur.fetchone()
                if ex and (ex[0] != m["sourceReleaseId"] or ex[1] != m["provisionVersionId"] or ex[2] != m["provisionId"]):
                    raise ValueError(f"Immutable identity collision in PostgreSQL for SnapshotMembership '{m['membershipId']}'")
                cur.execute("""
                    INSERT INTO snapshot_memberships (membership_id, source_release_id, provision_version_id, provision_id, source_order, hierarchy_path, source_locator, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (membership_id) DO NOTHING
                """, (m["membershipId"], m["sourceReleaseId"], m["provisionVersionId"], m["provisionId"], int(m["sourceOrder"]), m["hierarchyPath"], m["sourceLocator"], json.dumps(m)))
                rows += 1

            for ca in snap.get("citationAssignments", []):
                cur.execute("""
                    INSERT INTO citation_assignments (assignment_id, provision_id, normalized_citation, legacy_slug, editorial_review, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (assignment_id) DO UPDATE SET
                      editorial_review = EXCLUDED.editorial_review,
                      payload_json = EXCLUDED.payload_json
                """, (ca["assignmentId"], ca["provisionId"], ca["normalizedCitation"], ca["legacySlug"], ca.get("editorialReview", "accepted"), json.dumps(ca)))
                rows += 1

            for tr in snap.get("identityTransitions", []):
                cur.execute("""
                    INSERT INTO identity_transitions (transition_id, transition_kind, from_provision_id, from_citation, extraction_state, editorial_review, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (transition_id) DO UPDATE SET
                      extraction_state = EXCLUDED.extraction_state,
                      editorial_review = EXCLUDED.editorial_review,
                      payload_json = EXCLUDED.payload_json
                """, (tr["transitionId"], tr["transitionKind"], tr["fromProvisionId"], tr["fromCitation"], tr["extractionState"], tr["editorialReview"], json.dumps(tr)))
                rows += 1

            for ev in snap.get("evidenceSpans", []):
                cur.execute("SELECT artifact_sha256, excerpt_sha256, locator_value FROM evidence_spans WHERE evidence_id = %s", (ev["evidenceId"],))
                ex = cur.fetchone()
                if ex and (ex[0].strip() != ev["artifactSha256"] or ex[1].strip() != ev["excerptSha256"] or ex[2] != ev["locatorValue"]):
                    raise ValueError(f"Immutable identity collision in PostgreSQL for EvidenceSpan '{ev['evidenceId']}'")
                cur.execute("""
                    INSERT INTO evidence_spans (evidence_id, source_snapshot_id, artifact_sha256, locator_kind, locator_value, excerpt_sha256, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (evidence_id) DO NOTHING
                """, (ev["evidenceId"], ev["sourceSnapshotId"], ev["artifactSha256"], ev["locatorKind"], ev["locatorValue"], ev["excerptSha256"], json.dumps(ev)))
                rows += 1

            for la in snap.get("assertions", []):
                cur.execute("""
                    INSERT INTO legal_assertions (assertion_id, subject_id, relation_type, object_id, authority_kind, extraction_state, editorial_review, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (assertion_id) DO UPDATE SET
                      extraction_state = EXCLUDED.extraction_state,
                      editorial_review = EXCLUDED.editorial_review,
                      payload_json = EXCLUDED.payload_json
                """, (la["assertionId"], la["subjectId"], la["relationType"], la.get("objectId"), la["authorityKind"], la["extractionState"], la["editorialReview"], json.dumps(la)))
                rows += 1

            for ac in snap.get("applicabilityClaims", []):
                cur.execute("""
                    INSERT INTO applicability_claims (claim_id, target_provision_version_id, target_subdivision_locator, applicability_state, start_boundary, end_boundary, required_context_facts, editorial_review, payload_json)
                    VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s::jsonb)
                    ON CONFLICT (claim_id) DO UPDATE SET
                      applicability_state = EXCLUDED.applicability_state,
                      editorial_review = EXCLUDED.editorial_review,
                      payload_json = EXCLUDED.payload_json
                """, (ac["claimId"], ac["targetProvisionVersionId"], ac.get("targetSubdivisionLocator"), ac["applicabilityState"], json.dumps(ac["startBoundary"]), json.dumps(ac["endBoundary"]), json.dumps(ac.get("requiredContextFacts", [])), ac.get("editorialReview", "unreviewed"), json.dumps(ac)))
                rows += 1

            for obs in snap.get("observations", []):
                cur.execute("""
                    INSERT INTO historical_observations (observation_id, target_kind, target_id, observed_at, source_published_date, backfilled_historical_source, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (observation_id) DO UPDATE SET
                      payload_json = EXCLUDED.payload_json
                """, (obs["observationId"], obs["targetKind"], obs["targetId"], obs["observedAt"], obs.get("sourcePublishedDate"), bool(obs.get("backfilledHistoricalSource", False)), json.dumps(obs)))
                rows += 1

            for cov in snap.get("coverages", []):
                cur.execute("""
                    INSERT INTO collection_coverages (coverage_id, source_scope, source_family, release_id, coverage_state, is_required_for_publication, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (coverage_id) DO UPDATE SET
                      coverage_state = EXCLUDED.coverage_state,
                      payload_json = EXCLUDED.payload_json
                """, (cov["coverageId"], cov["sourceScope"], cov["sourceFamily"], cov.get("releaseId"), cov["coverageState"], bool(cov.get("isRequiredForPublication", True)), json.dumps(cov)))
                rows += 1

            for f in snap.get("findings", []):
                cur.execute("""
                    INSERT INTO findings (finding_id, fingerprint, kind, affected_scope, target_id, status, owner, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (finding_id) DO UPDATE SET
                      status = EXCLUDED.status,
                      payload_json = EXCLUDED.payload_json
                """, (f["findingId"], f["fingerprint"], f["kind"], f["affectedScope"], f["targetId"], f["status"], f["owner"], json.dumps(f)))
                rows += 1

            for da in snap.get("derivedArtifacts", []):
                cur.execute("""
                    INSERT INTO derived_artifacts (artifact_key, artifact_kind, target_scope, producer_id, producer_version, output_content_hash, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (artifact_key) DO UPDATE SET
                      output_content_hash = EXCLUDED.output_content_hash,
                      payload_json = EXCLUDED.payload_json
                """, (da["artifactKey"], da["artifactKind"], da["targetScope"], da["producerId"], da["producerVersion"], da["outputContentHash"], json.dumps(da)))
                rows += 1

    print(json.dumps({"ok": True, "data": {"tablesWritten": 15, "rowsUpserted": rows}}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
finally:
    conn.close()
`;
  return runPythonPgScript(script, snap, dbUrl);
}

/**
 * Full round-trip readback of all 15 canonical catalog tables from a real PostgreSQL instance (USCT-009, AUD-010).
 */
export async function loadCatalogFromPostgres(
  dbUrl = DEFAULT_POSTGRES_URL
): Promise<Result<CanonicalWorkbenchCatalog>> {
  const script = `
import json, sys, psycopg2

db_url = sys.argv[1]
conn = psycopg2.connect(db_url)
try:
    with conn:
        with conn.cursor() as cur:
            def fetch_json_list(table, order_col):
                cur.execute(f"SELECT payload_json FROM {table} ORDER BY {order_col}")
                return [row[0] for row in cur.fetchall()]

            data = {
                "schemaVersion": "usct.catalog-snapshot/v1",
                "artifacts": fetch_json_list("source_artifacts", "artifact_id"),
                "snapshots": fetch_json_list("source_snapshots", "snapshot_id"),
                "releases": fetch_json_list("source_releases", "release_id"),
                "provisions": fetch_json_list("provisions", "provision_id"),
                "provisionVersions": fetch_json_list("provision_versions", "provision_version_id"),
                "memberships": fetch_json_list("snapshot_memberships", "membership_id"),
                "citationAssignments": fetch_json_list("citation_assignments", "assignment_id"),
                "identityTransitions": fetch_json_list("identity_transitions", "transition_id"),
                "evidenceSpans": fetch_json_list("evidence_spans", "evidence_id"),
                "assertions": fetch_json_list("legal_assertions", "assertion_id"),
                "applicabilityClaims": fetch_json_list("applicability_claims", "claim_id"),
                "observations": fetch_json_list("historical_observations", "observation_id"),
                "coverages": fetch_json_list("collection_coverages", "coverage_id"),
                "findings": fetch_json_list("findings", "finding_id"),
                "derivedArtifacts": fetch_json_list("derived_artifacts", "artifact_key"),
            }
            print(json.dumps({"ok": True, "data": data}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
finally:
    conn.close()
`;
  const res = await runPythonPgScript<CatalogStateSnapshot>(script, {}, dbUrl);
  if (!res.ok) return res;
  const catalog = new CanonicalWorkbenchCatalog();
  const ing = catalog.ingestBundle(res.value);
  if (!ing.ok) return err(ing.error);
  return ok(catalog);
}

/**
 * Persist and reload durable FencedTaskCoordinator state in PostgreSQL across process restarts (USCT-035).
 */
export async function syncTaskCoordinatorToPostgres(
  coordinator: FencedTaskCoordinator,
  dbUrl = DEFAULT_POSTGRES_URL
): Promise<Result<{ tasksSynced: number; attemptsSynced: number }>> {
  const mig = await migratePostgres(dbUrl);
  if (!mig.ok) return mig;

  const exported = coordinator.exportState();
  const script = `
import json, os, sys, psycopg2

db_url = sys.argv[1]
state = json.loads(os.environ["PG_PAYLOAD_JSON"])
conn = psycopg2.connect(db_url)
try:
    with conn:
        with conn.cursor() as cur:
            for t in state.get("tasks", []):
                cur.execute("""
                    INSERT INTO accepted_tasks (task_id, current_generation, current_input_identity, highest_fencing_token, accepted_attempt_id, accepted_fencing_token, accepted_output_hash, accepted_at_iso, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (task_id) DO UPDATE SET
                      current_generation = EXCLUDED.current_generation,
                      current_input_identity = EXCLUDED.current_input_identity,
                      highest_fencing_token = EXCLUDED.highest_fencing_token,
                      accepted_attempt_id = EXCLUDED.accepted_attempt_id,
                      accepted_fencing_token = EXCLUDED.accepted_fencing_token,
                      accepted_output_hash = EXCLUDED.accepted_output_hash,
                      accepted_at_iso = EXCLUDED.accepted_at_iso,
                      payload_json = EXCLUDED.payload_json
                """, (t["taskId"], int(t["currentGeneration"]), t["currentInputIdentity"], int(t["highestFencingToken"]), t.get("acceptedAttemptId"), t.get("acceptedFencingToken"), t.get("acceptedOutputHash"), t.get("acceptedAtIso"), json.dumps(t)))
            for a in state.get("attempts", []):
                cur.execute("""
                    INSERT INTO task_attempts (attempt_id, task_id, generation, input_identity, owner_worker_id, fencing_token, lease_expires_at_ms, state, output_artifact_hash, rejection_reason, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (attempt_id) DO UPDATE SET
                      state = EXCLUDED.state,
                      output_artifact_hash = EXCLUDED.output_artifact_hash,
                      rejection_reason = EXCLUDED.rejection_reason,
                      payload_json = EXCLUDED.payload_json
                """, (a["attemptId"], a["taskId"], int(a["generation"]), a["inputIdentity"], a["ownerWorkerId"], int(a["fencingToken"]), int(a["leaseExpiresAtMs"]), a["state"], a.get("outputArtifactHash"), a.get("rejectionReason"), json.dumps(a)))
    print(json.dumps({"ok": True, "data": {"tasksSynced": len(state.get("tasks", [])), "attemptsSynced": len(state.get("attempts", []))}}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
finally:
    conn.close()
`;
  return runPythonPgScript(script, exported, dbUrl);
}

export async function loadTaskCoordinatorFromPostgres(
  dbUrl = DEFAULT_POSTGRES_URL
): Promise<Result<FencedTaskCoordinator>> {
  const script = `
import json, sys, psycopg2

db_url = sys.argv[1]
conn = psycopg2.connect(db_url)
try:
    with conn:
        with conn.cursor() as cur:
            cur.execute("SELECT payload_json FROM accepted_tasks ORDER BY task_id")
            tasks = [r[0] for r in cur.fetchall()]
            cur.execute("SELECT payload_json FROM task_attempts ORDER BY fencing_token")
            attempts = [r[0] for r in cur.fetchall()]
            print(json.dumps({"ok": True, "data": {"tasks": tasks, "attempts": attempts}}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
finally:
    conn.close()
`;
  const res = await runPythonPgScript<ReturnType<FencedTaskCoordinator['exportState']>>(script, {}, dbUrl);
  if (!res.ok) return res;
  const coord = new FencedTaskCoordinator();
  coord.importState(res.value);
  return ok(coord);
}

/**
 * Execute a real PostgreSQL Full-Text Search (FTS) query over `provision_versions.search_tsv` (USCT-023).
 * Uses `websearch_to_tsquery('english', ...)` and `ts_rank_cd(pv.search_tsv, q)` with optional
 * release, title, and review-state filters.
 */
export async function queryPostgresLexical(
  params: {
    query: string;
    releaseId?: string;
    uscTitle?: string;
    onlyAcceptedReview?: boolean;
    limit?: number;
  },
  dbUrl = DEFAULT_POSTGRES_URL
): Promise<Result<WorkbenchLexicalHit[]>> {
  const script = `
import json, os, sys, psycopg2

db_url = sys.argv[1]
p = json.loads(os.environ["PG_PAYLOAD_JSON"])
q = (p.get("query") or "").strip()
release_id = p.get("releaseId")
usc_title = p.get("uscTitle")
only_accepted = bool(p.get("onlyAcceptedReview", False))
limit = int(p.get("limit", 25))
withdrawal = p["withdrawal"]
withdrawn_versions = set(withdrawal["versionIds"])
withdrawn_hashes = set(withdrawal["artifactDigests"])

conn = psycopg2.connect(db_url)
try:
    with conn:
        with conn.cursor() as cur:
            sql = """
                SELECT
                  pv.provision_version_id,
                  pv.provision_id,
                  pv.usc_title,
                  pv.usc_section,
                  pv.heading,
                  pv.body_markdown,
                  pv.payload_json,
                  ts_rank_cd(pv.search_tsv, websearch_to_tsquery('english', %s)) AS fts_rank
                FROM provision_versions pv
                WHERE (
                  pv.search_tsv @@ websearch_to_tsquery('english', %s)
                  OR lower(pv.usc_title || ' u.s.c. ' || pv.usc_section) = lower(%s)
                  OR lower(pv.heading || ' ' || pv.body_markdown) LIKE %s
                )
            """
            args = [q, q, q, f"%{q.lower()}%"]
            if release_id:
                sql += " AND EXISTS (SELECT 1 FROM snapshot_memberships sm WHERE sm.provision_version_id = pv.provision_version_id AND sm.source_release_id = %s)"
                args.append(release_id)
            if usc_title:
                sql += " AND pv.usc_title = %s"
                args.append(str(usc_title))
            sql += " ORDER BY fts_rank DESC, pv.provision_version_id ASC"
            cur.execute(sql, tuple(args))
            rows = cur.fetchall()

            cur.execute("SELECT payload_json FROM citation_assignments")
            assignments = [r[0] for r in cur.fetchall()]
            cur.execute("SELECT payload_json FROM evidence_spans")
            ev_map = {r[0]["evidenceId"]: r[0] for r in cur.fetchall()}

            hits = []
            for r in rows:
                pv_id, prov_id, title, sec, heading, body, pv_json, fts_rank = r
                if pv_id in withdrawn_versions or any(ev_map.get(eid, {}).get("artifactSha256") in withdrawn_hashes for eid in pv_json.get("evidenceIds", [])):
                    continue
                matched_ca = None
                for ca in assignments:
                    if ca["provisionId"] == prov_id and (not release_id or release_id in ca.get("releaseIds", [])):
                        matched_ca = ca
                        break
                if only_accepted and (not matched_ca or matched_ca.get("editorialReview") != "accepted"):
                    continue
                citation = matched_ca["normalizedCitation"] if matched_ca else f"{title} U.S.C. {sec}"
                exact_bonus = 2.0 if citation.lower() == q.lower() else 0.0
                score = float(fts_rank or 0.1) + exact_bonus
                ev_ids = pv_json.get("evidenceIds", [])
                ev_spans = [ev_map[eid] for eid in ev_ids if eid in ev_map]
                hit = {
                    "provisionVersionId": pv_id,
                    "provisionId": prov_id,
                    "citation": citation,
                    "heading": heading,
                    "matchedExcerpt": " ".join(body.split())[:240],
                    "lexicalScore": score,
                    "combinedScore": score,
                    "evidenceSpans": ev_spans,
                }
                if release_id:
                    hit["releaseId"] = release_id
                hits.append(hit)
            hits.sort(key=lambda x: x["combinedScore"], reverse=True)
            print(json.dumps({"ok": True, "data": hits[:limit]}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
finally:
    conn.close()
`;
  return runPythonPgScript(script, { ...params, withdrawal: historicalWithdrawalIdentifiers() }, dbUrl);
}

/**
 * Execute a full PostgreSQL backup, destructive drop/truncate, and restore drill (USCT-028).
 * Verifies 100% row-count and snapshot digest parity before and after restore.
 */
export async function backupAndRestorePostgres(
  backupFilePath: string,
  dbUrl = DEFAULT_POSTGRES_URL
): Promise<
  Result<{
    backupFilePath: string;
    preDropDigest: string;
    postRestoreDigest: string;
    restoredRowCount: number;
    parityVerified: boolean;
  }>
> {
  const beforeLoad = await loadCatalogFromPostgres(dbUrl);
  if (!beforeLoad.ok) return beforeLoad;
  const beforeCoord = await loadTaskCoordinatorFromPostgres(dbUrl);
  if (!beforeCoord.ok) return beforeCoord;

  const preSnap = beforeLoad.value.getSnapshot();
  const preCoordState = beforeCoord.value.exportState();
  const preBundle = { catalog: preSnap, coordinator: preCoordState };
  const preJson = JSON.stringify(preBundle, null, 2);
  await mkdir(dirname(backupFilePath), { recursive: true });
  await writeFile(backupFilePath, preJson + '\n', 'utf-8');

  // Drop all 17 tables in PostgreSQL to simulate catastrophic loss
  const dropRes = await migratePostgres(dbUrl, { reset: true });
  if (!dropRes.ok) return dropRes;

  // Restore both catalog and task coordinator from backup snapshot
  const restoredCatalog = new CanonicalWorkbenchCatalog();
  const ing = restoredCatalog.ingestBundle(preSnap);
  if (!ing.ok) return err(ing.error);
  const syncRes = await syncCatalogToPostgres(restoredCatalog, dbUrl);
  if (!syncRes.ok) return syncRes;

  const restoredCoord = new FencedTaskCoordinator();
  restoredCoord.importState(preCoordState);
  const coordSyncRes = await syncTaskCoordinatorToPostgres(restoredCoord, dbUrl);
  if (!coordSyncRes.ok) return coordSyncRes;

  // Read back all 17 tables from PostgreSQL and compare digests
  const afterLoad = await loadCatalogFromPostgres(dbUrl);
  if (!afterLoad.ok) return afterLoad;
  const afterCoord = await loadTaskCoordinatorFromPostgres(dbUrl);
  if (!afterCoord.ok) return afterCoord;

  const postBundle = {
    catalog: afterLoad.value.getSnapshot(),
    coordinator: afterCoord.value.exportState(),
  };
  const postJson = JSON.stringify(postBundle, null, 2);

  const { sha256Hex } = await import('./workbench-catalog.js');
  const preDropDigest = sha256Hex(preJson);
  const postRestoreDigest = sha256Hex(postJson);

  if (preDropDigest !== postRestoreDigest) {
    return err(
      new Error(
        `PostgreSQL backup/restore digest mismatch: pre=${preDropDigest} !== post=${postRestoreDigest}`
      )
    );
  }

  return ok({
    backupFilePath,
    preDropDigest,
    postRestoreDigest,
    restoredRowCount:
      syncRes.value.rowsUpserted +
      coordSyncRes.value.tasksSynced +
      coordSyncRes.value.attemptsSynced,
    parityVerified: true,
  });
}

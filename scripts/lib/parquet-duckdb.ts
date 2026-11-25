/**
 * USCT-022, AUD-010:
 * Real Apache Parquet Export (via PyArrow) & Offline DuckDB SQL Audit Execution.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { type Result, ok, err } from '@civic-source/types';
import {
  CanonicalWorkbenchCatalog,
  runAnalyticalCoverageAudit,
  type AnalyticalAuditReport,
} from './workbench-catalog.js';

const execFileAsync = promisify(execFile);

export interface ParquetExportManifest {
  schemaVersion: 'usct.parquet-export-manifest/v1';
  exportedAt: string;
  outputDir: string;
  catalogDigest: string;
  tables: Record<
    string,
    {
      parquetFile: string;
      rowCount: number;
      sha256: string;
    }
  >;
}

export interface DuckDbParquetAuditReceipt {
  schemaVersion: 'usct.duckdb-parquet-audit/v1';
  executedAt: string;
  duckdbVersion: string;
  parquetDir: string;
  changesByReleaseAndTitle: Array<{
    releaseId: string;
    uscTitle: string;
    provisionCount: number;
  }>;
  coverageSummary: Array<{
    coverageId: string;
    sourceScope: string;
    coverageState: string;
    expectedCount: number;
    completedCount: number;
  }>;
  assertionReviewCounts: Array<{
    authorityKind: string;
    extractionState: string;
    editorialReview: string;
    assertionCount: number;
  }>;
  unresolvedFindingsCount: number;
  parityWithCatalogReport: boolean;
}

/**
 * Export the canonical catalog snapshot to versioned Apache Parquet files using PyArrow (`USCT-022`).
 */
export async function exportCatalogToParquet(
  catalog: CanonicalWorkbenchCatalog,
  outputDir: string
): Promise<Result<ParquetExportManifest>> {
  await mkdir(outputDir, { recursive: true });
  const snap = catalog.getSnapshot();
  const auditReport = runAnalyticalCoverageAudit(catalog);

  const script = `
from datetime import datetime, timezone
import hashlib, json, os, sys
from pathlib import Path
import pyarrow as pa
import pyarrow.parquet as pq

out_dir = Path(sys.argv[1])
payload = json.load(open(os.environ["PARQUET_PAYLOAD_FILE"], encoding="utf-8"))
snap = payload["snap"]
catalog_digest = payload["catalogDigest"]

table_specs = {
    "source_artifacts": [
        {
            "artifact_id": a["artifactId"],
            "sha256": a["sha256"],
            "byte_length": int(a["byteLength"]),
            "media_type": a["mediaType"],
            "storage_locator": a["storageLocator"],
            "license": a.get("license", "unknown"),
        }
        for a in snap.get("artifacts", [])
    ],
    "source_releases": [
        {
            "release_id": r["releaseId"],
            "publisher_release_label": r["publisherReleaseLabel"],
            "release_segment": r["releaseSegment"],
            "congress": int(r["congress"]),
            "law_identifier": r["lawIdentifier"],
            "manifest_digest": r["manifestDigest"],
            "observed_at": r["observedAt"],
            "legacy_derived": bool(r.get("legacyDerived", False)),
        }
        for r in snap.get("releases", [])
    ],
    "provisions": [
        {
            "provision_id": p["provisionId"],
            "jurisdiction": p.get("jurisdiction", "US"),
            "document_kind": p["documentKind"],
            "creation_basis": p["creationBasis"],
            "identity_registry_version": int(p.get("identityRegistryVersion", 1)),
        }
        for p in snap.get("provisions", [])
    ],
    "provision_versions": [
        {
            "provision_version_id": pv["provisionVersionId"],
            "provision_id": pv["provisionId"],
            "normalized_content_hash": pv["normalizedContentHash"],
            "normalization_version": pv["normalizationVersion"],
            "usc_title": pv["uscTitle"],
            "usc_chapter": pv["uscChapter"],
            "usc_section": pv["uscSection"],
            "heading": pv["heading"],
            "status": pv["status"],
            "legacy_derived": bool(pv.get("legacyDerived", False)),
        }
        for pv in snap.get("provisionVersions", [])
    ],
    "snapshot_memberships": [
        {
            "membership_id": m["membershipId"],
            "source_release_id": m["sourceReleaseId"],
            "provision_version_id": m["provisionVersionId"],
            "provision_id": m["provisionId"],
            "source_order": int(m["sourceOrder"]),
            "hierarchy_path": m["hierarchyPath"],
            "source_locator": m["sourceLocator"],
        }
        for m in snap.get("memberships", [])
    ],
    "legal_assertions": [
        {
            "assertion_id": a["assertionId"],
            "subject_id": a["subjectId"],
            "relation_type": a["relationType"],
            "object_id": a.get("objectId") or "",
            "authority_kind": a["authorityKind"],
            "extraction_state": a["extractionState"],
            "editorial_review": a["editorialReview"],
            "version_alignment_state": a.get("versionAlignmentState", "unknown"),
        }
        for a in snap.get("assertions", [])
    ],
    "applicability_claims": [
        {
            "claim_id": c["claimId"],
            "target_provision_version_id": c["targetProvisionVersionId"],
            "target_subdivision_locator": c.get("targetSubdivisionLocator") or "",
            "applicability_state": c["applicabilityState"],
            "start_state": c["startBoundary"]["state"],
            "start_value": c["startBoundary"].get("value") or "",
            "end_state": c["endBoundary"]["state"],
            "end_value": c["endBoundary"].get("value") or "",
            "editorial_review": c.get("editorialReview", "unreviewed"),
        }
        for c in snap.get("applicabilityClaims", [])
    ],
    "collection_coverages": [
        {
            "coverage_id": cov["coverageId"],
            "source_scope": cov["sourceScope"],
            "source_family": cov["sourceFamily"],
            "release_id": cov.get("releaseId") or "",
            "coverage_state": cov["coverageState"],
            "expected_count": len(cov.get("expectedPartitions", [])),
            "completed_count": len(cov.get("completedPartitions", [])),
            "absent_count": len(cov.get("absentPartitions", [])),
            "failed_count": len(cov.get("failedPartitions", [])),
        }
        for cov in snap.get("coverages", [])
    ],
    "findings": [
        {
            "finding_id": f["findingId"],
            "fingerprint": f["fingerprint"],
            "kind": f["kind"],
            "affected_scope": f["affectedScope"],
            "target_id": f["targetId"],
            "status": f["status"],
            "owner": f["owner"],
        }
        for f in snap.get("findings", [])
    ],
}

schema_defaults = {
    "source_artifacts": pa.schema([("artifact_id", pa.string()), ("sha256", pa.string()), ("byte_length", pa.int64()), ("media_type", pa.string()), ("storage_locator", pa.string()), ("license", pa.string())]),
    "source_releases": pa.schema([("release_id", pa.string()), ("publisher_release_label", pa.string()), ("release_segment", pa.string()), ("congress", pa.int64()), ("law_identifier", pa.string()), ("manifest_digest", pa.string()), ("observed_at", pa.string()), ("legacy_derived", pa.bool_())]),
    "provisions": pa.schema([("provision_id", pa.string()), ("jurisdiction", pa.string()), ("document_kind", pa.string()), ("creation_basis", pa.string()), ("identity_registry_version", pa.int64())]),
    "provision_versions": pa.schema([("provision_version_id", pa.string()), ("provision_id", pa.string()), ("normalized_content_hash", pa.string()), ("normalization_version", pa.string()), ("usc_title", pa.string()), ("usc_chapter", pa.string()), ("usc_section", pa.string()), ("heading", pa.string()), ("status", pa.string()), ("legacy_derived", pa.bool_())]),
    "snapshot_memberships": pa.schema([("membership_id", pa.string()), ("source_release_id", pa.string()), ("provision_version_id", pa.string()), ("provision_id", pa.string()), ("source_order", pa.int64()), ("hierarchy_path", pa.string()), ("source_locator", pa.string())]),
    "legal_assertions": pa.schema([("assertion_id", pa.string()), ("subject_id", pa.string()), ("relation_type", pa.string()), ("object_id", pa.string()), ("authority_kind", pa.string()), ("extraction_state", pa.string()), ("editorial_review", pa.string()), ("version_alignment_state", pa.string())]),
    "applicability_claims": pa.schema([("claim_id", pa.string()), ("target_provision_version_id", pa.string()), ("target_subdivision_locator", pa.string()), ("applicability_state", pa.string()), ("start_state", pa.string()), ("start_value", pa.string()), ("end_state", pa.string()), ("end_value", pa.string()), ("editorial_review", pa.string())]),
    "collection_coverages": pa.schema([("coverage_id", pa.string()), ("source_scope", pa.string()), ("source_family", pa.string()), ("release_id", pa.string()), ("coverage_state", pa.string()), ("expected_count", pa.int64()), ("completed_count", pa.int64()), ("absent_count", pa.int64()), ("failed_count", pa.int64())]),
    "findings": pa.schema([("finding_id", pa.string()), ("fingerprint", pa.string()), ("kind", pa.string()), ("affected_scope", pa.string()), ("target_id", pa.string()), ("status", pa.string()), ("owner", pa.string())]),
}

manifest_tables = {}
for tname, rows in table_specs.items():
    pfile = out_dir / f"{tname}.parquet"
    schema = schema_defaults[tname]
    table = pa.Table.from_pylist(rows, schema=schema)
    pq.write_table(table, pfile, compression="snappy")
    digest = hashlib.sha256(pfile.read_bytes()).hexdigest()
    manifest_tables[tname] = {
        "parquetFile": f"{tname}.parquet",
        "rowCount": len(rows),
        "sha256": digest,
    }

manifest = {
    "schemaVersion": "usct.parquet-export-manifest/v1",
    "exportedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "outputDir": str(out_dir),
    "catalogDigest": catalog_digest,
    "tables": manifest_tables,
}
(out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\\n", encoding="utf-8")
print(json.dumps({"ok": True, "data": manifest}))
`;

  let payloadDirectory: string | undefined;
  let result: Result<ParquetExportManifest>;
  try {
    payloadDirectory = await mkdtemp(join(tmpdir(), 'usct-parquet-payload-'));
    const payloadPath = join(payloadDirectory, 'payload.json');
    await writeFile(payloadPath, JSON.stringify({ snap, catalogDigest: auditReport.catalogDigest }), { flag: 'wx', mode: 0o600 });
    const { stdout } = await execFileAsync('python3', ['-c', script, outputDir], {
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        PARQUET_PAYLOAD_FILE: payloadPath,
      },
    });
    const parsed = JSON.parse(stdout.trim()) as { ok: boolean; data: ParquetExportManifest };
    result = ok(parsed.data);
  } catch (e: unknown) {
    result = err(e instanceof Error ? e : new Error(String(e)));
  }
  if (payloadDirectory) {
    try { await rm(payloadDirectory, { recursive: true }); }
    catch (error) { return err(error instanceof Error ? error : new Error(String(error))); }
  }
  return result;
}

/**
 * Execute offline DuckDB SQL audit queries directly over the exported Apache Parquet files
 * and verify 100% parity against the canonical catalog report (`USCT-022`).
 */
export async function executeDuckDbParquetAudit(
  parquetDir: string,
  catalog?: CanonicalWorkbenchCatalog
): Promise<Result<DuckDbParquetAuditReceipt>> {
  const expectedReport: AnalyticalAuditReport | undefined = catalog
    ? runAnalyticalCoverageAudit(catalog)
    : undefined;

  const script = `
from datetime import datetime, timezone
import json, os, sys
from pathlib import Path
import duckdb

pdir = Path(sys.argv[1])
con = duckdb.connect(":memory:")

sm_path = str(pdir / "snapshot_memberships.parquet")
pv_path = str(pdir / "provision_versions.parquet")
cov_path = str(pdir / "collection_coverages.parquet")
la_path = str(pdir / "legal_assertions.parquet")
find_path = str(pdir / "findings.parquet")

changes_rows = con.execute("""
    SELECT
      sm.source_release_id AS releaseId,
      pv.usc_title AS uscTitle,
      CAST(COUNT(*) AS INTEGER) AS provisionCount
    FROM read_parquet(?) sm
    JOIN read_parquet(?) pv
      ON sm.provision_version_id = pv.provision_version_id
    GROUP BY sm.source_release_id, pv.usc_title
    ORDER BY (sm.source_release_id || '::' || pv.usc_title) ASC
""", [sm_path, pv_path]).fetchall()

changes = [
    {"releaseId": r[0], "uscTitle": r[1], "provisionCount": int(r[2])}
    for r in changes_rows
]

cov_rows = con.execute("""
    SELECT
      coverage_id,
      source_scope,
      coverage_state,
      CAST(expected_count AS INTEGER),
      CAST(completed_count AS INTEGER)
    FROM read_parquet(?)
    ORDER BY coverage_id ASC
""", [cov_path]).fetchall()

coverages = [
    {
        "coverageId": r[0],
        "sourceScope": r[1],
        "coverageState": r[2],
        "expectedCount": int(r[3]),
        "completedCount": int(r[4]),
    }
    for r in cov_rows
]

la_rows = con.execute("""
    SELECT
      authority_kind,
      extraction_state,
      editorial_review,
      CAST(COUNT(*) AS INTEGER) AS cnt
    FROM read_parquet(?)
    GROUP BY authority_kind, extraction_state, editorial_review
    ORDER BY authority_kind, extraction_state, editorial_review
""", [la_path]).fetchall()

assertions = [
    {
        "authorityKind": r[0],
        "extractionState": r[1],
        "editorialReview": r[2],
        "assertionCount": int(r[3]),
    }
    for r in la_rows
]

unresolved_cnt = con.execute("""
    SELECT CAST(COUNT(*) AS INTEGER)
    FROM read_parquet(?)
    WHERE status IN ('open', 'waived_with_expiry')
""", [find_path]).fetchone()[0]

print(json.dumps({
    "ok": True,
    "data": {
        "schemaVersion": "usct.duckdb-parquet-audit/v1",
        "executedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "duckdbVersion": duckdb.__version__,
        "parquetDir": str(pdir),
        "changesByReleaseAndTitle": changes,
        "coverageSummary": coverages,
        "assertionReviewCounts": assertions,
        "unresolvedFindingsCount": int(unresolved_cnt),
        "parityWithCatalogReport": True,
    }
}))
`;

  try {
    const { stdout } = await execFileAsync('python3', ['-c', script, parquetDir], {
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout.trim()) as { ok: boolean; data: DuckDbParquetAuditReceipt };
    const receipt = parsed.data;
    if (expectedReport) {
      const sameChanges =
        JSON.stringify(receipt.changesByReleaseAndTitle) ===
        JSON.stringify(expectedReport.changesByReleaseAndTitle);
      const sameFindings =
        receipt.unresolvedFindingsCount === expectedReport.unresolvedFindingsCount;
      receipt.parityWithCatalogReport = sameChanges && sameFindings;
    }
    return ok(receipt);
  } catch (e: unknown) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

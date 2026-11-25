import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FencedTaskCoordinator,
  runPilotParityAndRecoveryDrill,
  sha256Hex,
} from '../lib/workbench-catalog.js';
import { buildCanonicalVerticalSlice } from '../lib/canonical-vertical-slice.js';
import {
  DEFAULT_POSTGRES_URL,
  backupAndRestorePostgres,
  loadCatalogFromPostgres,
  loadTaskCoordinatorFromPostgres,
  queryPostgresLexical,
  syncCatalogToPostgres,
  syncTaskCoordinatorToPostgres,
} from '../lib/postgres-bridge.js';
import {
  executeDuckDbParquetAudit,
  exportCatalogToParquet,
} from '../lib/parquet-duckdb.js';

function isPostgresAvailable(dbUrl: string): boolean {
  try {
    execFileSync(
      'python3',
      ['-c', 'import sys, psycopg2; psycopg2.connect(sys.argv[1]).close()', dbUrl],
      { stdio: 'ignore' }
    );
    return true;
  } catch {
    return false;
  }
}

const PG_AVAILABLE = isPostgresAvailable(DEFAULT_POSTGRES_URL);

describe.runIf(PG_AVAILABLE)('PostgreSQL 16 + Apache Parquet + DuckDB E2E Integration (AUD-010 / USCT-009 / USCT-022 / USCT-023 / USCT-028 / USCT-035)', () => {
  let sliceWorkDir = '';

  beforeAll(async () => {
    sliceWorkDir = await mkdtemp(join(tmpdir(), 'usct-pg-e2e-'));
    return async () => {
      await rm(sliceWorkDir, { recursive: true, force: true });
    };
  });

  it('syncs canonical slice to PostgreSQL 16, enforces immutable conflict rollback, queries lexically, persists TaskAttempt state, backs up/restores, and passes DuckDB/Parquet parity', async () => {
    const dataRepoPath = join(process.cwd(), 'apps/web/content-data');
    const { catalog, coordinator } = await buildCanonicalVerticalSlice({
      sliceDir: join(sliceWorkDir, 'slice'),
      dataRepoPath,
    });

    // 1. Sync full 15-entity canonical catalog to real PostgreSQL 16 and read back
    const syncRes = await syncCatalogToPostgres(catalog, DEFAULT_POSTGRES_URL, { resetFirst: true });
    expect(syncRes.ok).toBe(true);
    if (!syncRes.ok) return;
    expect(syncRes.value.tablesWritten).toBe(15);
    expect(syncRes.value.rowsUpserted).toBeGreaterThan(20);

    const readback = await loadCatalogFromPostgres(DEFAULT_POSTGRES_URL);
    expect(readback.ok).toBe(true);
    if (!readback.ok) return;
    expect(readback.value.getSnapshot().provisions.length).toBe(catalog.getSnapshot().provisions.length);
    expect(readback.value.getSnapshot().provisionVersions.length).toBe(catalog.getSnapshot().provisionVersions.length);

    // 2. Real PostgreSQL FTS lexical retrieval (USCT-023)
    const ftsRes = await queryPostgresLexical(
      { query: '18 U.S.C. 371', releaseId: 'pl-119-73' },
      DEFAULT_POSTGRES_URL
    );
    expect(ftsRes.ok).toBe(true);
    if (!ftsRes.ok) return;
    expect(ftsRes.value.length).toBeGreaterThan(0);
    expect(ftsRes.value[0]?.provisionId).toBe('prov-18-371');
    expect(ftsRes.value[0]?.evidenceSpans).toEqual([]);
    const withdrawn = await queryPostgresLexical({ query: '18 U.S.C. 1001', releaseId: 'pl-119-73' }, DEFAULT_POSTGRES_URL);
    expect(withdrawn.ok && withdrawn.value).toEqual([]);

    // 3. Immutable conflict rejection in real PostgreSQL transaction (AUD-002 / USCT-009)
    const mutatedSnap = catalog.getSnapshot();
    mutatedSnap.provisionVersions[0] = {
      ...mutatedSnap.provisionVersions[0]!,
      bodyMarkdown: 'MUTATED CONFLICTING TEXT IN POSTGRES',
      normalizedContentHash: sha256Hex('MUTATED CONFLICTING TEXT IN POSTGRES'),
    };
    const conflictCatalog = new (catalog.constructor as typeof catalog.constructor & (new () => typeof catalog))();
    conflictCatalog.ingestBundle(mutatedSnap);
    const conflictSync = await syncCatalogToPostgres(conflictCatalog, DEFAULT_POSTGRES_URL, {
      resetFirst: false,
    });
    expect(conflictSync.ok).toBe(false);

    // 4. Durable FencedTaskCoordinator PostgreSQL persistence & stale fencing across restart (USCT-035)
    const coordSync = await syncTaskCoordinatorToPostgres(coordinator, DEFAULT_POSTGRES_URL);
    expect(coordSync.ok).toBe(true);
    const reloadedCoordRes = await loadTaskCoordinatorFromPostgres(DEFAULT_POSTGRES_URL);
    expect(reloadedCoordRes.ok).toBe(true);
    if (!reloadedCoordRes.ok) return;
    const reloadedCoord: FencedTaskCoordinator = reloadedCoordRes.value;
    const staleOverwrite = reloadedCoord.proposeAcceptance({
      attemptId: 'attempt-slice-v1',
      outputArtifactHash: 'conflicting-output-hash',
      nowMs: Date.now(),
    });
    expect(staleOverwrite.ok).toBe(false);

    // 5. Full PostgreSQL backup -> drop -> restore parity drill (USCT-028)
    const backupRes = await backupAndRestorePostgres(
      join(sliceWorkDir, 'pg-backup.json'),
      DEFAULT_POSTGRES_URL
    );
    expect(backupRes.ok).toBe(true);
    if (!backupRes.ok) return;
    expect(backupRes.value.parityVerified).toBe(true);
    expect(backupRes.value.postRestoreDigest).toBe(backupRes.value.preDropDigest);

    // 6. Real Apache Parquet export + DuckDB SQL audit + Parity receipt (USCT-022)
    const pqDir = join(sliceWorkDir, 'parquet');
    const pqRes = await exportCatalogToParquet(readback.value, pqDir);
    expect(pqRes.ok).toBe(true);
    if (!pqRes.ok) return;
    expect(Object.keys(pqRes.value.tables)).toContain('provision_versions');

    const duckRes = await executeDuckDbParquetAudit(pqDir, readback.value);
    expect(duckRes.ok).toBe(true);
    if (!duckRes.ok) return;
    expect(duckRes.value.parityWithCatalogReport).toBe(true);
    expect(duckRes.value.changesByReleaseAndTitle.length).toBeGreaterThan(0);

    // 7. Corrupt derived index recovery drill from canonical snapshot (USCT-026 / USCT-028)
    const drill = await runPilotParityAndRecoveryDrill({
      catalog: readback.value,
      publicationId: 'pub-e2e-test',
      workDir: join(sliceWorkDir, 'drill'),
    });
    expect(drill.cleanVsIncrementalDigestMatch).toBe(true);
    expect(drill.recoveredFromCorruptIndexMatch).toBe(true);
  }, 30_000);
});

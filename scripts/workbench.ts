#!/usr/bin/env npx tsx
/**
 * USCT-008 through USCT-028, USCT-034, USCT-035, USCT-036:
 * Canonical Local Workbench CLI (File-backed, PostgreSQL 16, Parquet/DuckDB, Shards, Neighborhoods, Topics)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  CanonicalWorkbenchCatalog,
  FencedTaskCoordinator,
  buildHistoricalSearchShards,
  computeDependencyImpact,
  computeExportAttribution,
  evaluateFindingRatchet,
  runAnalyticalCoverageAudit,
  runPilotParityAndRecoveryDrill,
  sha256Hex,
  type CatalogStateSnapshot,
} from './lib/workbench-catalog.js';
import {
  buildCanonicalVerticalSlice,
  writeCuratedTopicDatasets,
  writeStaticNeighborhoodShards,
} from './lib/canonical-vertical-slice.js';
import {
  DEFAULT_POSTGRES_URL,
  backupAndRestorePostgres,
  loadCatalogFromPostgres,
  migratePostgres,
  queryPostgresLexical,
  syncCatalogToPostgres,
  syncTaskCoordinatorToPostgres,
} from './lib/postgres-bridge.js';
import {
  executeDuckDbParquetAudit,
  exportCatalogToParquet,
} from './lib/parquet-duckdb.js';

async function main() {
  const { values } = parseArgs({
    options: {
      action: { type: 'string', default: 'migrate-sql' },
      catalog: { type: 'string', default: '.workbench/catalog.json' },
      coordinator: { type: 'string', default: '.workbench/task-coordinator.json' },
      'slice-dir': { type: 'string', default: 'data/canonical-slice' },
      bundle: { type: 'string' },
      'data-repo': { type: 'string', default: 'apps/web/content-data' },
      releases: { type: 'string', default: 'pl-116-220,pl-119-73' },
      release: { type: 'string' },
      citation: { type: 'string' },
      cutoff: { type: 'string' },
      date: { type: 'string' },
      subdivision: { type: 'string' },
      query: { type: 'string' },
      title: { type: 'string' },
      publication: { type: 'string', default: 'pub-pl-119-73-d2fd4df0d55d' },
      output: { type: 'string', default: 'apps/web/public/search-shards' },
      'parquet-dir': { type: 'string', default: '.workbench/parquet' },
      'backup-file': { type: 'string', default: '.workbench/pg-backup.json' },
      'db-url': { type: 'string', default: DEFAULT_POSTGRES_URL },
      source: { type: 'string', default: 'ecfr' },
    },
  });

  const action = values.action;
  if (action === 'migrate-sql') {
    console.log(CanonicalWorkbenchCatalog.getPostgresMigrationSql());
    return;
  }

  if (action === 'migrate-postgres') {
    const res = await migratePostgres(values['db-url'], { reset: true });
    if (!res.ok) throw res.error;
    console.log(JSON.stringify(res.value, null, 2));
    return;
  }

  let catalog = new CanonicalWorkbenchCatalog();
  try {
    catalog = await CanonicalWorkbenchCatalog.loadFromFile(values.catalog);
  } catch {
    // New catalog if file does not exist yet
  }

  if (action === 'ingest') {
    if (!values.bundle) {
      console.error('--bundle <path> is required for --action ingest');
      process.exit(1);
    }
    const raw = await readFile(values.bundle, 'utf-8');
    const partial = JSON.parse(raw) as Partial<CatalogStateSnapshot>;
    const res = catalog.ingestBundle(partial);
    if (!res.ok) {
      console.error(`Ingestion failed: ${res.error.message}`);
      process.exit(1);
    }
    await catalog.saveToFile(values.catalog);
    console.log(`Ingested bundle into ${values.catalog}`);
  } else if (action === 'build-canonical-slice' || action === 'ingest-git-cohort') {
    let pubId = values.publication;
    try {
      const rawReceipt = await readFile('apps/web/public/publication-receipt.json', 'utf-8');
      const parsedReceipt = JSON.parse(rawReceipt) as { publicationId?: string };
      if (parsedReceipt.publicationId) pubId = parsedReceipt.publicationId;
    } catch {
      // keep CLI publication value
    }

    const { catalog: sliceCatalog, coordinator } = await buildCanonicalVerticalSlice({
      sliceDir: values['slice-dir'],
      dataRepoPath: values['data-repo'],
    });
    catalog = sliceCatalog;
    await catalog.saveToFile(values.catalog);
    await coordinator.saveToFile(values.coordinator);

    const { manifest, shards } = buildHistoricalSearchShards(catalog, pubId);
    const manifestPath = join(values.output, 'manifest.json');
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    for (const [shardKey, shard] of shards.entries()) {
      const shardFile = join(values.output, `${shardKey}.json`);
      await writeFile(shardFile, JSON.stringify(shard, null, 2) + '\n', 'utf-8');
    }

    const neighborhoods = await writeStaticNeighborhoodShards(
      catalog,
      'apps/web/public/neighborhoods'
    );
    const topics = await writeCuratedTopicDatasets(catalog, 'apps/web/public/topics');

    console.log(
      JSON.stringify(
        {
          action,
          catalogPath: values.catalog,
          coordinatorPath: values.coordinator,
          sliceDir: values['slice-dir'],
          publicationId: pubId,
          shardsBuilt: shards.size,
          neighborhoodShardsBuilt: neighborhoods.shardCount,
          topicsBuilt: topics.length,
        },
        null,
        2
      )
    );
  } else if (action === 'sync-postgres') {
    const syncRes = await syncCatalogToPostgres(catalog, values['db-url'], { resetFirst: true });
    if (!syncRes.ok) throw syncRes.error;
    const readback = await loadCatalogFromPostgres(values['db-url']);
    if (!readback.ok) throw readback.error;
    try {
      const { FencedTaskCoordinator } = await import('./lib/workbench-catalog.js');
      const coord = await FencedTaskCoordinator.loadFromFile(values.coordinator);
      const cSync = await syncTaskCoordinatorToPostgres(coord, values['db-url']);
      if (!cSync.ok) throw cSync.error;
    } catch {
      // Optional if coordinator file not created yet
    }
    console.log(
      JSON.stringify(
        {
          synced: syncRes.value,
          readbackProvisions: readback.value.getSnapshot().provisions.length,
          readbackVersions: readback.value.getSnapshot().provisionVersions.length,
        },
        null,
        2
      )
    );
  } else if (action === 'query-postgres-lexical') {
    if (!values.query) {
      console.error('--query <str> is required');
      process.exit(1);
    }
    const res = await queryPostgresLexical(
      {
        query: values.query,
        ...(values.release ? { releaseId: values.release } : {}),
        ...(values.title ? { uscTitle: values.title } : {}),
      },
      values['db-url']
    );
    if (!res.ok) throw res.error;
    console.log(JSON.stringify(res.value, null, 2));
  } else if (action === 'backup-restore-postgres') {
    const res = await backupAndRestorePostgres(values['backup-file'], values['db-url']);
    if (!res.ok) throw res.error;
    console.log(JSON.stringify(res.value, null, 2));
  } else if (action === 'export-parquet') {
    const res = await exportCatalogToParquet(catalog, values['parquet-dir']);
    if (!res.ok) throw res.error;
    console.log(JSON.stringify(res.value, null, 2));
  } else if (action === 'query-duckdb') {
    const res = await executeDuckDbParquetAudit(values['parquet-dir'], catalog);
    if (!res.ok) throw res.error;
    console.log(JSON.stringify(res.value, null, 2));
  } else if (action === 'query-as-published') {
    if (!values.release || !values.citation) {
      console.error('--release <id> and --citation <str> are required');
      process.exit(1);
    }
    console.log(
      JSON.stringify(
        catalog.queryAsPublished({ releaseId: values.release, citation: values.citation }),
        null,
        2
      )
    );
  } else if (action === 'query-known-as-of') {
    if (!values.cutoff || !values.citation) {
      console.error('--cutoff <iso> and --citation <str> are required');
      process.exit(1);
    }
    console.log(
      JSON.stringify(
        catalog.queryKnownAsOf({ cutoffObservedAt: values.cutoff, citation: values.citation }),
        null,
        2
      )
    );
  } else if (action === 'query-applicable') {
    if (!values.date || !values.citation) {
      console.error('--date <YYYY-MM-DD> and --citation <str> are required');
      process.exit(1);
    }
    console.log(
      JSON.stringify(
        catalog.queryLegallyApplicable({
          requestedLegalDate: values.date,
          citation: values.citation,
          ...(values.subdivision ? { subdivisionLocator: values.subdivision } : {}),
        }),
        null,
        2
      )
    );
  } else if (action === 'resolve-citation') {
    if (!values.citation) {
      console.error('--citation <str> is required');
      process.exit(1);
    }
    console.log(JSON.stringify(catalog.resolveCitation(values.citation, values.release), null, 2));
  } else if (action === 'build-shards') {
    const { manifest, shards } = buildHistoricalSearchShards(catalog, values.publication);
    const manifestPath = join(values.output, 'manifest.json');
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    for (const [shardKey, shard] of shards.entries()) {
      const shardFile = join(values.output, `${shardKey}.json`);
      await writeFile(shardFile, JSON.stringify(shard, null, 2) + '\n', 'utf-8');
    }
    console.log(`Built ${shards.size} historical search shards into ${values.output}`);
  } else if (action === 'audit') {
    const audit = runAnalyticalCoverageAudit(catalog);
    const attribution = computeExportAttribution(catalog.getSnapshot().artifacts);
    console.log(JSON.stringify({ ...audit, attribution }, null, 2));
  } else if (action === 'review-inbox') {
    const snap = catalog.getSnapshot();
    const nowIso = new Date().toISOString();
    const ratchet = evaluateFindingRatchet({
      currentFindings: snap.findings,
      baselineFingerprints: new Set(),
      nowIso,
    });
    const unresolvedTransitions = snap.identityTransitions.filter(
      (t) => t.editorialReview !== 'accepted'
    );
    const disputedOrConditionalClaims = snap.applicabilityClaims.filter(
      (c) => c.applicabilityState === 'disputed' || c.editorialReview !== 'accepted'
    );
    console.log(
      JSON.stringify(
        {
          schemaVersion: 'usct.review-inbox/v1',
          generatedAt: nowIso,
          openOrWaivedFindings: snap.findings.filter(
            (f) => f.status === 'open' || f.status === 'waived_with_expiry'
          ),
          recentlyResolvedFindings: snap.findings.filter(
            (f) => f.status === 'resolved_editorial'
          ),
          unresolvedTransitionsCount: unresolvedTransitions.length,
          disputedOrUnreviewedClaims: disputedOrConditionalClaims.map((c) => ({
            claimId: c.claimId,
            targetProvisionVersionId: c.targetProvisionVersionId,
            applicabilityState: c.applicabilityState,
            editorialReview: c.editorialReview,
          })),
          ratchetPassed: ratchet.passed,
        },
        null,
        2
      )
    );
  } else if (action === 'refresh-source') {
    const source = values.source ?? 'ecfr';
    const coordinator = await FencedTaskCoordinator.loadFromFile(values.coordinator).catch(
      () => new FencedTaskCoordinator()
    );
    const snap = catalog.getSnapshot();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const attempt = coordinator.startAttempt({
      taskId: `refresh-source:${source}`,
      attemptId: `attempt-${source}-${nowMs}`,
      inputIdentity: `${source}:${snap.coverages.map((c) => c.coverageId).join(',')}`,
      ownerWorkerId: 'workbench-refresh-worker',
      nowMs,
      leaseDurationMs: 60_000,
    });

    const impact = computeDependencyImpact(snap.derivedArtifacts, {
      modifiedCollectionInputs: [`source:${source}:refreshed`],
    });
    const refreshedHash = sha256Hex(JSON.stringify({ source, snapDigest: runAnalyticalCoverageAudit(catalog).catalogDigest }));
    const accRes = coordinator.proposeAcceptance({
      attemptId: attempt.attemptId,
      outputArtifactHash: refreshedHash,
      nowMs: nowMs + 5,
      nowIso,
    });
    if (!accRes.ok) throw accRes.error;
    await coordinator.saveToFile(values.coordinator);
    await syncTaskCoordinatorToPostgres(coordinator, values['db-url']).catch(() => null);

    console.log(
      JSON.stringify(
        {
          action: 'refresh-source',
          source,
          attemptId: attempt.attemptId,
          fencingToken: attempt.fencingToken,
          generation: attempt.generation,
          acceptanceStatus: accRes.value.status,
          retransformedStatutesCount: 0,
          invalidatedArtifactsCount: impact.invalidatedArtifacts.length,
          unaffectedArtifactsCount: impact.unaffectedArtifacts.length,
        },
        null,
        2
      )
    );
  } else if (action === 'pilot-metrics') {
    const t0 = performance.now();
    const snap = catalog.getSnapshot();
    const drill = await runPilotParityAndRecoveryDrill({
      catalog,
      publicationId: values.publication,
      workDir: '.workbench/pilot-drill',
    });
    const tSync0 = performance.now();
    const pgSync = await syncCatalogToPostgres(catalog, values['db-url'], { resetFirst: true });
    const pgSyncMs = Math.round(performance.now() - tSync0);
    const tParquet0 = performance.now();
    const pqRes = await exportCatalogToParquet(catalog, values['parquet-dir']);
    const parquetMs = Math.round(performance.now() - tParquet0);
    const tDuck0 = performance.now();
    const duckRes = await executeDuckDbParquetAudit(values['parquet-dir'], catalog);
    const duckdbMs = Math.round(performance.now() - tDuck0);

    const casTotalBytes = snap.artifacts.reduce((acc, a) => acc + a.byteLength, 0);
    console.log(
      JSON.stringify(
        {
          schemaVersion: 'usct.pilot-metrics/v1',
          measuredAt: new Date().toISOString(),
          counts: {
            artifacts: snap.artifacts.length,
            snapshots: snap.snapshots.length,
            releases: snap.releases.length,
            provisions: snap.provisions.length,
            provisionVersions: snap.provisionVersions.length,
            evidenceSpans: snap.evidenceSpans.length,
            assertions: snap.assertions.length,
            applicabilityClaims: snap.applicabilityClaims.length,
            coverages: snap.coverages.length,
            findings: snap.findings.length,
          },
          retainedCasBytes: casTotalBytes,
          timingsMs: {
            totalPilotMs: Math.round(performance.now() - t0),
            postgresSyncMs: pgSyncMs,
            parquetExportMs: parquetMs,
            duckdbAuditMs: duckdbMs,
            recoveryDrillMs: drill.elapsedMs,
          },
          parity: {
            cleanVsIncrementalDigestMatch: drill.cleanVsIncrementalDigestMatch,
            recoveredFromCorruptIndexMatch: drill.recoveredFromCorruptIndexMatch,
            postgresSyncedRows: pgSync.ok ? pgSync.value.rowsUpserted : 0,
            parquetFilesWritten: pqRes.ok ? Object.keys(pqRes.value.tables).length : 0,
            duckdbParityVerified: duckRes.ok ? duckRes.value.parityWithCatalogReport : false,
          },
        },
        null,
        2
      )
    );
  } else {
    console.error(`Unknown action: ${action}`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('workbench.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

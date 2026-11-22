#!/usr/bin/env npx tsx
/**
 * USCT-008, USCT-009, USCT-011, USCT-022, USCT-034, USCT-036:
 * Canonical Local Workbench CLI
 *
 * Usage:
 *   npx tsx scripts/workbench.ts --action migrate-sql
 *   npx tsx scripts/workbench.ts --action ingest --catalog data/catalog.json --bundle data/bundle.json
 *   npx tsx scripts/workbench.ts --action query-as-published --catalog data/catalog.json --release pl-119-73 --citation "18 U.S.C. 1001"
 *   npx tsx scripts/workbench.ts --action query-known-as-of --catalog data/catalog.json --cutoff 2026-11-21T00:00:00Z --citation "18 U.S.C. 1001"
 *   npx tsx scripts/workbench.ts --action query-applicable --catalog data/catalog.json --date 2027-01-15 --citation "26 U.S.C. 9999"
 *   npx tsx scripts/workbench.ts --action resolve-citation --catalog data/catalog.json --citation "42 U.S.C. 1000"
 *   npx tsx scripts/workbench.ts --action build-shards --catalog data/catalog.json --publication pub-1 --output apps/web/public/search-shards
 *   npx tsx scripts/workbench.ts --action audit --catalog data/catalog.json
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  CanonicalWorkbenchCatalog,
  buildHistoricalSearchShards,
  runAnalyticalCoverageAudit,
  type CatalogStateSnapshot,
} from './lib/workbench-catalog.js';

async function main() {
  const { values } = parseArgs({
    options: {
      action: { type: 'string', default: 'migrate-sql' },
      catalog: { type: 'string', default: '.workbench/catalog.json' },
      bundle: { type: 'string' },
      release: { type: 'string' },
      citation: { type: 'string' },
      cutoff: { type: 'string' },
      date: { type: 'string' },
      subdivision: { type: 'string' },
      publication: { type: 'string', default: 'pub-local' },
      output: { type: 'string', default: 'apps/web/public/search-shards' },
    },
  });

  const action = values.action;
  if (action === 'migrate-sql') {
    console.log(CanonicalWorkbenchCatalog.getPostgresMigrationSql());
    return;
  }

  let catalog = new CanonicalWorkbenchCatalog();
  try {
    catalog = await CanonicalWorkbenchCatalog.loadFromFile(values.catalog);
  } catch {
    // New catalog if file does not exist yet during ingest
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
    console.log(JSON.stringify(runAnalyticalCoverageAudit(catalog), null, 2));
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

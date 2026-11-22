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

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import {
  CanonicalWorkbenchCatalog,
  buildHistoricalSearchShards,
  runAnalyticalCoverageAudit,
  type CatalogStateSnapshot,
} from './lib/workbench-catalog.js';

const execFileAsync = promisify(execFile);

const DEFAULT_COHORT_PATHS = [
  'statutes/title-18/chapter-1/section-2.md',
  'statutes/title-18/chapter-7/section-111.md',
  'statutes/title-18/chapter-19/section-371.md',
  'statutes/title-18/chapter-47/section-1001.md',
  'statutes/title-18/chapter-63/section-1341.md',
  'statutes/title-18/chapter-63/section-1343.md',
  'statutes/title-18/chapter-95/section-1951.md',
  'statutes/title-18/chapter-96/section-1962.md',
];

async function main() {
  const { values } = parseArgs({
    options: {
      action: { type: 'string', default: 'migrate-sql' },
      catalog: { type: 'string', default: '.workbench/catalog.json' },
      bundle: { type: 'string' },
      'data-repo': { type: 'string', default: 'apps/web/content-data' },
      releases: { type: 'string', default: 'pl-116-220,pl-119-73' },
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
  } else if (action === 'ingest-git-cohort') {
    const dataRepo = values['data-repo'] ?? 'apps/web/content-data';
    const releaseTags = (values.releases ?? 'pl-116-220,pl-119-73')
      .split(',')
      .map((s) => s.trim())
      .filter((t) => /^pl-\d+-[a-z0-9-]+$/i.test(t));

    for (const relTag of releaseTags) {
      const mRel = /^pl-(\d+)-(.+)$/i.exec(relTag);
      if (!mRel) continue;
      const congress = parseInt(mRel[1]!, 10);
      const law = mRel[2]!;

      catalog.ingestBundle({
        releases: [
          {
            schemaVersion: 'usct.source-release/v1',
            releaseId: relTag,
            publisherReleaseLabel: `Public Law ${congress}-${law}`,
            releaseSegment: `${congress}/${law}`,
            congress,
            lawIdentifier: law,
            exclusions: [],
            revisionNumber: 1,
            snapshotIds: [],
            coverageId: `cov-${relTag}`,
            manifestDigest: createHash('sha256').update(relTag).digest('hex'),
            observedAt: new Date().toISOString(),
            legacyDerived: false,
          },
        ],
      });

      let order = 1;
      for (const relPath of DEFAULT_COHORT_PATHS) {
        let md = '';
        try {
          const { stdout } = await execFileAsync('git', ['show', `${relTag}:${relPath}`], {
            cwd: dataRepo,
          });
          md = stdout;
        } catch {
          continue;
        }

        const mPath = /^statutes\/title-(\d+)\/chapter-([^/]+)\/section-([^.]+)\.md$/.exec(relPath);
        if (!mPath) continue;
        const [, title, chapter, section] = mPath;
        const headingMatch = /^#\s+(.+)$/m.exec(md);
        const heading = headingMatch ? headingMatch[1]!.trim() : `§ ${section}`;
        const body = md.replace(/^---[\s\S]*?---\n*/m, '').trim();
        const hash = createHash('sha256').update(body).digest('hex');
        const provId = `prov-${title}-${section}`;
        const pvId = `pv-${title}-${section}-${relTag}`;

        const res = catalog.ingestBundle({
          provisions: [
            {
              schemaVersion: 'usct.provision/v1',
              provisionId: provId,
              jurisdiction: 'US',
              documentKind: 'usc_section',
              creationBasis: `olrc_uslm_id:/us/usc/t${title}/s${section}`,
              identityRegistryVersion: 1,
            },
          ],
          provisionVersions: [
            {
              schemaVersion: 'usct.provision-version/v1',
              provisionVersionId: pvId,
              provisionId: provId,
              normalizedContentHash: hash,
              normalizationVersion: '1.0.0',
              uscTitle: title!,
              uscChapter: chapter!,
              uscSection: section!,
              heading,
              status: 'active',
              bodyMarkdown: body,
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
              membershipId: `mem-${relTag}-${provId}`,
              sourceReleaseId: relTag,
              provisionVersionId: pvId,
              provisionId: provId,
              sourceOrder: order++,
              hierarchyPath: `title-${title}/chapter-${chapter}/section-${section}`,
              sourceLocator: `/us/usc/t${title}/s${section}`,
            },
          ],
          citationAssignments: [
            {
              schemaVersion: 'usct.citation-assignment/v1',
              assignmentId: `ca-${provId}-${relTag}`,
              provisionId: provId,
              normalizedCitation: `${title} U.S.C. ${section}`,
              legacySlug: `title-${title}/chapter-${chapter}/section-${section}`,
              releaseIds: [relTag],
              evidenceIds: [],
              editorialReview: 'accepted',
            },
          ],
        });
        if (!res.ok) throw res.error;
      }
    }

    const { manifest, shards } = buildHistoricalSearchShards(catalog, values.publication);
    const manifestPath = join(values.output, 'manifest.json');
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    for (const [shardKey, shard] of shards.entries()) {
      const shardFile = join(values.output, `${shardKey}.json`);
      await writeFile(shardFile, JSON.stringify(shard, null, 2) + '\n', 'utf-8');
    }
    console.log(`Ingested cohort and built ${shards.size} historical search shards into ${values.output}`);
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

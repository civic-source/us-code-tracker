#!/usr/bin/env npx tsx
/**
 * Title-Parameterized Batch Enrichment & Coverage CLI
 *
 * Computes OLRC / eCFR / CourtListener CollectionCoverage for any U.S. Code
 * title and optionally executes resumable, rate-limit-guarded sidecar enrichment.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Annotator, CourtListenerClient, getApiToken } from '@civic-source/annotator';
import { createLogger } from '@civic-source/shared';
import { fetchRegulationsWithOutcome } from './extract-regulations.js';
import {
  MIN_POLITE_DELAY_MS,
  clampPoliteDelayMs,
  runTitleEnrichmentBatch,
  type EnrichmentSource,
  type TitleEnrichmentBatchOptions,
  type TitleEnrichmentBatchSummary,
} from './lib/title-enrichment-batch.js';

function parseSourcesArg(raw: string): EnrichmentSource[] {
  const items = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (items.length === 0) throw new Error('At least one source must be specified via --sources');
  for (const item of items) {
    if (item !== 'ecfr' && item !== 'courtlistener') {
      throw new Error(`Unsupported source "${item}"; expected ecfr or courtlistener`);
    }
  }
  return [...new Set(items)] as EnrichmentSource[];
}

function parseOptionalInt(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`Invalid integer for --${label}: "${raw}"`);
  return Number.parseInt(raw.trim(), 10);
}

function buildLiveOptions(dryRun: boolean, sources: EnrichmentSource[]): Partial<TitleEnrichmentBatchOptions> {
  if (dryRun) return {};
  const result: Partial<TitleEnrichmentBatchOptions> = {};
  if (sources.includes('ecfr')) {
    result.fetchEcfr = ({ uscTitle, section, priorSnapshot, nowIso }) =>
      fetchRegulationsWithOutcome(uscTitle, section, { priorSnapshot, nowIso });
  }
  if (sources.includes('courtlistener')) {
    const token = getApiToken();
    const logger = createLogger('enrich-title', 'warn');
    const annotator = new Annotator({ client: new CourtListenerClient({ token, logger }), logger });
    result.fetchCourtListener = ({ citation, priorAnnotation }) =>
      annotator.annotateSectionWithOutcome(citation, priorAnnotation);
  }
  return result;
}

function printSummary(summary: TitleEnrichmentBatchSummary): void {
  const { olrc_uslm: olrc, ecfr, courtlistener: cl } = summary.coverageAfter.report.sources;
  console.log(`Title ${summary.uscTitle} Enrichment (${summary.dryRun ? 'dry-run' : 'live'}):`);
  console.log(`  Discovered sections: ${summary.totalDiscoveredSections}`);
  console.log(`  Pending backlog:     ${summary.candidateBacklogCount} (selected=${summary.selectedCount}, skipped=${summary.skippedCount})`);
  console.log(`  Processed/Written:   ${summary.processedCount}/${summary.writtenCount} (failed=${summary.failedCount}, rateLimits=${summary.rateLimitCount})`);
  console.log(`  Delay floor:         ${summary.effectiveDelayMs}ms (onlyMissing=${String(summary.onlyMissing)})`);
  console.log(`  OLRC coverage:       ${olrc.coverageState} (${olrc.completedCount}/${olrc.expectedCount})`);
  console.log(`  eCFR coverage:       ${ecfr.coverageState} (${ecfr.completedCount}/${ecfr.expectedCount}, missing=${ecfr.missingCount}, failed=${ecfr.failedCount})`);
  console.log(`  CourtListener cov:   ${cl.coverageState} (${cl.completedCount}/${cl.expectedCount}, missing=${cl.missingCount}, failed=${cl.failedCount})`);
  if (summary.haltedByCircuitBreaker) {
    console.warn(`  Circuit breaker:     HALTED (${summary.haltReason ?? 'rate limit threshold reached'})`);
  }
}

function parseCliOptions(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      title: { type: 'string', short: 't' }, 'data-repo': { type: 'string', short: 'd', default: 'apps/web/content-data' },
      sources: { type: 'string', short: 's', default: 'ecfr,courtlistener' }, limit: { type: 'string', short: 'l' },
      offset: { type: 'string', short: 'o', default: '0' }, 'only-missing': { type: 'boolean', default: true },
      all: { type: 'boolean', default: false }, 'delay-ms': { type: 'string', default: String(MIN_POLITE_DELAY_MS) },
      'dry-run': { type: 'boolean', default: false }, 'coverage-out': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  }).values;
}

/** Run the title enrichment CLI with explicit argument array and return an exit code. */
export async function runEnrichTitleCli(argv: string[]): Promise<number> {
  let batchOpts: TitleEnrichmentBatchOptions;
  let coverageOut: string | undefined;
  try {
    const values = parseCliOptions(argv);
    if (values.help || !values.title) {
      console.log('Usage: enrich-title.ts --title <N> [--data-repo <dir>] [--sources ecfr,courtlistener] [--limit <n>] [--offset <n>] [--only-missing|--all] [--delay-ms <ms>] [--dry-run] [--coverage-out <file>]');
      return values.help ? 0 : 1;
    }
    coverageOut = values['coverage-out'];
    const sources = parseSourcesArg(values.sources ?? 'ecfr,courtlistener');
    const dryRun = values['dry-run'] ?? false;
    batchOpts = {
      dataRepoPath: resolve(values['data-repo'] ?? 'apps/web/content-data'),
      uscTitle: values.title,
      sources,
      onlyMissing: values.all ? false : (values['only-missing'] ?? true),
      limit: parseOptionalInt(values.limit, 'limit'),
      offset: parseOptionalInt(values.offset, 'offset') ?? 0,
      delayMs: clampPoliteDelayMs(parseOptionalInt(values['delay-ms'], 'delay-ms')),
      dryRun,
      ...buildLiveOptions(dryRun, sources),
    };
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const res = await runTitleEnrichmentBatch(batchOpts);
  if (!res.ok) {
    console.error(`Enrichment failed: ${res.error.message}`);
    return 1;
  }
  printSummary(res.value);
  if (coverageOut) {
    const outPath = resolve(coverageOut);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(res.value.coverageAfter, null, 2) + '\n', 'utf-8');
  }
  return res.value.haltedByCircuitBreaker ? 1 : 0;
}

if (process.argv[1]?.endsWith('enrich-title.ts')) {
  runEnrichTitleCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error('Fatal error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  );
}

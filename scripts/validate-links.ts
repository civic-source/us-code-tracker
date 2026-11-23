#!/usr/bin/env npx tsx
/**
 * Domain-specific link validator CLI for civic-source/us-code-tracker.
 *
 * Modes:
 * - offline: deterministic verification of centralized URL builders, static
 *   JSON/Markdown/source URLs, deprecated OLRC/DOJ patterns, and internal topic links.
 * - live: polite rate-limited HTTP probing of authoritative legal endpoints,
 *   live OLRC parser smoke checks, and bounded sidecar sampling.
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type LinkValidationIssue,
  type OfflineValidationResult,
  runOfflineLinkValidation,
  scanFileForUrls,
  validateExtractedUrl,
} from './lib/link-validation-offline.js';
import {
  type LinkCheckStatus,
  type LiveProbeOutcome,
  type LiveProbeTarget,
  type LiveValidationResult,
  detectSoft404,
  probeUrl,
  runLiveLinkValidation,
} from './lib/link-validation-live.js';

export type ValidationMode = 'offline' | 'live';
export type {
  LinkValidationIssue,
  OfflineValidationResult,
  LinkCheckStatus,
  LiveProbeTarget,
  LiveProbeOutcome,
  LiveValidationResult,
};
export {
  validateExtractedUrl,
  scanFileForUrls,
  runOfflineLinkValidation,
  detectSoft404,
  probeUrl,
  runLiveLinkValidation,
};

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Format a concise Markdown report suitable for CI step summaries. */
export function formatMarkdownSummary(
  mode: ValidationMode,
  result: OfflineValidationResult | LiveValidationResult
): string {
  if (mode === 'offline' && 'filesScanned' in result) {
    const lines = [
      '## Link Validation (Offline)',
      `- Status: ${result.ok ? 'PASSED' : 'FAILED'}`,
      `- Files scanned: ${result.filesScanned}`,
      `- URLs checked: ${result.urlsChecked} (${result.builderChecks} builder assertions)`,
      `- Issues: ${result.issues.length}`,
    ];
    for (const issue of result.issues) {
      lines.push(`  - \`${issue.source}\`: ${issue.url} — ${issue.reason}`);
    }
    return lines.join('\n') + '\n';
  }

  if (!('totalProbed' in result)) {
    throw new Error(`Unexpected result shape for mode "${mode}"`);
  }
  const lines = [
    '## Live External Link Check',
    `- Status: ${result.ok ? 'PASSED' : 'FAILED'}`,
    `- Probed: ${result.totalProbed} | OK: ${result.okCount} | Throttled/Warn: ${result.warnCount} | Failed: ${result.failCount}`,
    `- OLRC live parser: ${result.olrcParserChecks.currentPublicLaw || 'N/A'} (${result.olrcParserChecks.downloadTitles} title ZIPs, ${result.olrcParserChecks.priorReleases} prior releases)`,
  ];
  const nonOk = result.outcomes.filter((o) => o.status !== 'ok');
  if (nonOk.length > 0) {
    lines.push('', '| Status | Source | URL | Detail |', '| --- | --- | --- | --- |');
    for (const item of nonOk) {
      lines.push(
        `| ${escapeCell(item.status)} | ${escapeCell(item.source)} | ${escapeCell(item.url)} | ${escapeCell(item.reason)} |`
      );
    }
  }
  return lines.join('\n') + '\n';
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string', default: 'offline' },
      root: { type: 'string', default: process.cwd() },
      json: { type: 'boolean', default: false },
      'strict-warnings': { type: 'boolean', default: false },
      'summary-file': { type: 'string' },
    },
    strict: true,
  });

  if (values.mode !== 'offline' && values.mode !== 'live') {
    console.error(`Invalid --mode "${values.mode}"; expected "offline" or "live".`);
    process.exit(1);
  }

  const rootDir = resolve(values.root);
  if (values.mode === 'offline') {
    const result = await runOfflineLinkValidation(rootDir);
    if (values['summary-file']) {
      await writeFile(values['summary-file'], formatMarkdownSummary('offline', result), {
        flag: 'a',
      });
    }
    console.log(
      values.json ? JSON.stringify(result, null, 2) : formatMarkdownSummary('offline', result)
    );
    if (!result.ok) process.exit(1);
    return;
  }

  const result = await runLiveLinkValidation(rootDir);
  if (values['summary-file']) {
    await writeFile(values['summary-file'], formatMarkdownSummary('live', result), {
      flag: 'a',
    });
  }
  console.log(
    values.json ? JSON.stringify(result, null, 2) : formatMarkdownSummary('live', result)
  );
  const hasStrictWarning = values['strict-warnings'] && result.warnCount > 0;
  if (!result.ok || hasStrictWarning) {
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('validate-links.ts')) {
  main().catch((error: unknown) => {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

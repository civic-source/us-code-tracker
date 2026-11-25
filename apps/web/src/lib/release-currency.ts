import { acceptedReleaseContext } from './accepted-release-context';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ReleaseCurrencyDisplay {
  tag: string;
  shortLabel: string;
  formalLabel: string;
  dataRevision?: number;
}

const FALLBACK_DISPLAY: ReleaseCurrencyDisplay = {
  tag: 'pl-119-142',
  shortLabel: 'PL 119-142',
  formalLabel: 'Pub. L. 119-142',
};

/** Format an OLRC release tag (e.g. `pl-119-142` or `pl-119-102not101`) for UI badges. */
export function formatReleaseTag(rawTag: string): ReleaseCurrencyDisplay {
  const context = acceptedReleaseContext(rawTag);
  if (!context) return FALLBACK_DISPLAY;
  const suffix = context.publisherReleaseId.slice(3);
  return {
    tag: context.dataTag,
    shortLabel: `PL ${suffix}`,
    formalLabel: `Pub. L. ${suffix}`,
    ...(context.dataRevision === undefined ? {} : { dataRevision: context.dataRevision }),
  };
}

/**
 * Walk ancestor directories from both the module location (handles both source `src/lib/`
 * and built Astro `.prerender/chunks/`) and `process.cwd()` to locate `publication-receipt.json`.
 */
export function resolveDefaultReceiptCandidates(): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const add = (p: string): void => {
    const abs = resolve(p);
    if (!seen.has(abs)) {
      seen.add(abs);
      candidates.push(abs);
    }
  };

  let cur = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 7; i++) {
    add(resolve(cur, 'public/publication-receipt.json'));
    add(resolve(cur, 'publication-receipt.json'));
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  add(resolve(process.cwd(), 'public/publication-receipt.json'));
  add(resolve(process.cwd(), 'apps/web/public/publication-receipt.json'));
  return candidates;
}

/** Read the accepted publication tag from `publication-receipt.json` with a safe fallback. */
export function getCurrentReleaseDisplay(receiptPath?: string | URL): ReleaseCurrencyDisplay {
  if (receiptPath !== undefined) {
    try {
      const raw = readFileSync(receiptPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'acceptedDataTag' in parsed &&
        typeof parsed.acceptedDataTag === 'string'
      ) {
        return formatReleaseTag(parsed.acceptedDataTag);
      }
    } catch {
      return FALLBACK_DISPLAY;
    }
    return FALLBACK_DISPLAY;
  }

  for (const candidate of resolveDefaultReceiptCandidates()) {
    if (!existsSync(candidate)) continue;
    try {
      const raw = readFileSync(candidate, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'acceptedDataTag' in parsed &&
        typeof parsed.acceptedDataTag === 'string'
      ) {
        return formatReleaseTag(parsed.acceptedDataTag);
      }
    } catch {
      // Continue trying next candidate
    }
  }
  console.warn('[release-currency] Could not resolve publication-receipt.json; using fallback release tag');
  return FALLBACK_DISPLAY;
}

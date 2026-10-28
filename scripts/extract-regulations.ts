#!/usr/bin/env npx tsx
/**
 * eCFR Parallel Table of Authorities (PTOA) Sidecar Generator
 *
 * Queries the official open eCFR API to discover administrative rules and CFR parts
 * derived from enabling U.S. Code sections, and outputs .regulations.json sidecars.
 *
 * Usage:
 *   npx tsx scripts/extract-regulations.ts --title 42 --section 7401 --output apps/web/content-data/regulations/
 *   npx tsx scripts/extract-regulations.ts --title 18 --output apps/web/content-data/regulations/ --limit 50
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  SectionRegulationsSchema,
  type ImplementingRegulation,
} from '@civic-source/types';

interface ECFRSearchResult {
  hierarchy: {
    title: string;
    part: string;
    chapter?: string;
  };
  headings: {
    title: string;
    part: string;
    chapter?: string;
  };
}

export async function fetchImplementingRegulations(
  uscTitle: string | number,
  uscSection: string
): Promise<ImplementingRegulation[]> {
  const query = `"${uscTitle} U.S.C. ${uscSection}"`;
  const url = `https://www.ecfr.gov/api/search/v1/results?query=${encodeURIComponent(query)}&per_page=10`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return [];
    }

    const data = await res.json() as { results?: ECFRSearchResult[] };
    if (!data.results || !Array.isArray(data.results)) {
      return [];
    }

    const regulationsMap = new Map<string, ImplementingRegulation>();

    for (const item of data.results) {
      const cfrTitle = parseInt(item.hierarchy?.title ?? '', 10);
      const cfrPart = parseInt(item.hierarchy?.part ?? '', 10);
      if (isNaN(cfrTitle) || isNaN(cfrPart) || cfrTitle <= 0 || cfrPart <= 0) {
        continue;
      }

      const key = `${cfrTitle}-${cfrPart}`;
      if (regulationsMap.has(key)) continue;

      const agency = item.headings?.chapter?.trim() || item.headings?.title?.trim() || 'Federal Agency';
      const description = item.headings?.part?.trim() || undefined;
      const ecfrUrl = `https://www.ecfr.gov/current/title-${cfrTitle}/part-${cfrPart}`;

      regulationsMap.set(key, {
        cfrTitle,
        cfrPart,
        agency,
        description,
        ecfrUrl,
      });
    }

    return Array.from(regulationsMap.values());
  } catch {
    return [];
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      title: { type: 'string', short: 't' },
      section: { type: 'string', short: 's' },
      output: { type: 'string', short: 'o', default: 'apps/web/content-data/regulations' },
    },
  });

  if (!values.title || !values.section) {
    console.error('Usage: extract-regulations.ts --title <num> --section <sec> [--output <dir>]');
    process.exit(1);
  }

  const { title, section, output } = values;
  console.log(`Extracting implementing regulations for ${title} U.S.C. § ${section}...`);

  const regulations = await fetchImplementingRegulations(title, section);
  console.log(`Found ${regulations.length} regulatory parts.`);

  const sidecar = {
    targetSection: `${title}-${section}`,
    lastUpdated: new Date().toISOString(),
    regulations,
  };

  // Validate with Zod schema
  const parsed = SectionRegulationsSchema.parse(sidecar);

  const outDir = join(output, `title-${title}`);
  await mkdir(outDir, { recursive: true });

  const outFile = join(outDir, `section-${section}.json`);
  await writeFile(outFile, JSON.stringify(parsed, null, 2), 'utf-8');
  console.log(`Wrote sidecar to: ${outFile}`);
}

if (process.argv[1]?.endsWith('extract-regulations.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

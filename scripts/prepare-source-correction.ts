#!/usr/bin/env npx tsx
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { prepareSourceCorrection } from './lib/source-correction-candidate.js';

function required(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  if (typeof value !== 'string' || !value.length) throw new Error(`Missing --${key}; use --help`);
  return value;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({ args, strict: true, options: {
    xml: { type: 'string' }, sha256: { type: 'string' }, title: { type: 'string' },
    sections: { type: 'string' }, release: { type: 'string' },
    'generated-at': { type: 'string' }, output: { type: 'string' }, purpose: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: tsx scripts/prepare-source-correction.ts --xml <retained.xml> --sha256 <digest> --title <18> --sections <19,111,1001> --release "PL 119-142" --generated-at <canonical ISO timestamp> --output <new directory>');
    return 0;
  }
  if (values.purpose !== undefined && values.purpose !== 'bounded-audit') throw new Error('Unknown source-correction purpose');
  const result = await prepareSourceCorrection({ sourceXml: required(values, 'xml'),
    expectedSha256: required(values, 'sha256'), title: required(values, 'title'),
    sections: required(values, 'sections').split(','), releaseLabel: required(values, 'release'),
    generatedAt: required(values, 'generated-at'), outputDirectory: required(values, 'output'),
    ...(values.purpose ? { purpose: values.purpose } : {}) });
  if (!result.ok) {
    console.error(result.error.message);
    return 1;
  }
  console.log(JSON.stringify(result.value, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}

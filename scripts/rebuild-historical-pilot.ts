import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { materializePinnedHistory } from './lib/olrc-history-materialize.js';
import { requireHistoricalQualification } from './lib/historical-qualification.js';

const { values } = parseArgs({ options: { cache: { type: 'string' }, output: { type: 'string' }, candidate: { type: 'boolean', default: false } } });
if (!values.cache || !values.output) throw new Error('Specify --cache and a NEW --output directory; --candidate emits unaccepted proposals');
const result = await materializePinnedHistory({ cacheDir: resolve(values.cache) });
if (!result.ok) throw result.error;
if (!values.candidate) for (const item of result.value) requireHistoricalQualification(item.version);
await mkdir(values.output);
await writeFile(join(values.output, 'materializations.json'), JSON.stringify({
  schemaVersion: 'usct.historical-materializations/v1', records: result.value.map(({ version, recordSha256 }) => ({ version, recordSha256 })),
}, null, 2) + '\n', { flag: 'wx' });
await writeFile(join(values.output, 'qualification.json'), JSON.stringify({
  schemaVersion: values.candidate ? 'usct.candidate-history-materializations/v1' : 'usct.reviewed-history-materializations/v1', records: result.value.map(({ version, recordSha256 }) => ({
    provisionVersionId: version.provisionVersionId, recordSha256, sourceQualification: version.sourceQualification,
  })),
}, null, 2) + '\n', { flag: 'wx' });
for (const { version, witness } of result.value) await writeFile(join(values.output, `${version.sourceQualification!.releaseId}-${version.uscSection}-witness.json`), witness, { flag: 'wx' });
console.log(JSON.stringify({ accepted: !values.candidate, qualifiedSections: result.value.length, output: values.output }));

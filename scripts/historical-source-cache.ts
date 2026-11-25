import type { Result } from '@civic-source/types';
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { historicalSourcePins } from './lib/olrc-historical-sources.js';
import { exportSourceCache, importSourceCache } from './lib/olrc-source-export.js';
import { publishGithubSources, restoreGithubSources } from './lib/olrc-source-github.js';

const { values } = parseArgs({ options: {
  action: { type: 'string' }, cache: { type: 'string' }, directory: { type: 'string' },
  repository: { type: 'string' }, 'producer-revision': { type: 'string' }, receipt: { type: 'string' },
} });
if (!values.cache || !values.directory) throw new Error('Specify --cache and --directory (a NEW directory for exports/readback)');
const pins = historicalSourcePins.map(source => source.archive);
let result: Result<unknown>;
if (values.action === 'export') result = await exportSourceCache({ cacheDir: values.cache, outputDir: values.directory, pins });
else if (values.action === 'import') result = await importSourceCache({ cacheDir: values.cache, inputDir: values.directory, pins });
else if (values.action === 'github-restore' && values.repository) result = await restoreGithubSources({ cacheDir: values.cache,
  readbackDir: values.directory, pins, repository: values.repository });
else if (values.action === 'github-publish' && values.repository && values['producer-revision']) result = await publishGithubSources({
  cacheDir: values.cache, workDir: values.directory, pins, repository: values.repository, producerRevision: values['producer-revision'] });
else throw new Error('Unknown action or missing explicit repository/producer revision');
if (!result.ok) throw result.error;
const receipt = JSON.stringify({ action: values.action, result: result.value ?? null }, null, 2) + '\n';
if (values.receipt) await writeFile(values.receipt, receipt, { flag: 'wx' });
process.stdout.write(receipt);

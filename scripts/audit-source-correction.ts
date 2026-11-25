import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { auditSourceCorrection } from './lib/source-audit.js';

function required(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  if (typeof value !== 'string' || !value.length) throw new Error(`Missing --${key}`);
  return value;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({ args, strict: true, options: {
    inventory: { type: 'string' }, archive: { type: 'string' }, 'data-repo': { type: 'string' },
    'accepted-ref': { type: 'string' }, 'generated-at': { type: 'string' }, output: { type: 'string' },
    'resume-from': { type: 'string' }, 'resume-sha256': { type: 'string' },
    sections: { type: 'string' }, all: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Offline fragment audit: --inventory JSON --archive ZIP --data-repo DIR --accepted-ref SHA --generated-at ISO --output NEW_DIR (--sections 31,111 | --all) [--resume-from PRIOR_DIR --resume-sha256 SHA]');
    return 0;
  }
  const result = await auditSourceCorrection({ inventory: required(values, 'inventory'), archive: required(values, 'archive'),
    dataRepository: required(values, 'data-repo'), acceptedRef: required(values, 'accepted-ref'),
    generatedAt: required(values, 'generated-at'), outputDirectory: required(values, 'output'),
    ...(values['resume-from'] ? { resumeFrom: values['resume-from'] } : {}),
    ...(values['resume-sha256'] ? { resumeSha256: values['resume-sha256'] } : {}),
    ...(values.all ? { all: true, ...(values.sections ? { sections: values.sections.split(',') } : {}) }
      : { sections: required(values, 'sections').split(',') }) });
  if (!result.ok) { console.error(result.error.message); return 2; }
  console.log(JSON.stringify(result.value));
  return result.value.operationalFailures ? 2 : result.value.selectedFragmentQualified ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2;
  });
}

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { err, ok, type Result } from '@civic-source/types';
import { EcfrBulkExtractedTitleSchema, type EcfrBulkExtractedTitle } from '../../packages/types/src/ecfr-bulk.js';

export const EXTRACTOR_VERSION = 'ecfr-authority/1';
const helper = new URL('../python/ecfr_bulk_extract.py', import.meta.url);
const execute = promisify(execFile);
const maxOutput = 64 * 1024 * 1024;

export async function extractorIdentity(): Promise<Result<{ version: string; digest: string }>> {
  try {
    const [python, bridge] = await Promise.all([readFile(helper), readFile(fileURLToPath(import.meta.url))]);
    const digest = createHash('sha256').update(EXTRACTOR_VERSION).update('\0').update(python).update('\0').update(bridge).digest('hex');
    return ok({ version: EXTRACTOR_VERSION, digest });
  } catch (error) {
    return err(new Error(`Cannot identify eCFR extractor: ${error instanceof Error ? error.message : String(error)}`));
  }
}

export async function extractTitle(options: {
  filePath: string; cfrTitle: number; sourceSha256: string;
}): Promise<Result<EcfrBulkExtractedTitle>> {
  try {
    if (!Number.isInteger(options.cfrTitle) || options.cfrTitle < 1 || options.cfrTitle > 50 || !/^[a-f0-9]{64}$/.test(options.sourceSha256)) {
      return err(new Error('Invalid eCFR extraction identity'));
    }
    const { stdout } = await execute('python3', [fileURLToPath(helper), options.filePath, String(options.cfrTitle), options.sourceSha256], {
      timeout: 120_000, maxBuffer: maxOutput, encoding: 'utf8',
    });
    const parsed = EcfrBulkExtractedTitleSchema.safeParse(JSON.parse(stdout) as unknown);
    if (!parsed.success) return err(new Error(`Invalid eCFR extraction: ${parsed.error.message}`));
    if (parsed.data.cfrTitle !== options.cfrTitle || parsed.data.sourceSha256 !== options.sourceSha256 ||
        parsed.data.authorities.some((entry, index) => entry.cfrTitle !== options.cfrTitle || entry.sourceSha256 !== options.sourceSha256 || entry.ordinal !== index + 1)) {
      return err(new Error('Inconsistent eCFR extracted authority identity'));
    }
    return ok(parsed.data);
  } catch (error) {
    return err(new Error(`Cannot extract eCFR title ${options.cfrTitle}: ${error instanceof Error ? error.message : String(error)}`));
  }
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { err, ok, type Result } from '@civic-source/types';
import type { SourceBlobPin } from './olrc-source-cache.js';

const exec = promisify(execFile);
const helper = fileURLToPath(new URL('../python/olrc_archive_member.py', import.meta.url));

export async function extractArchiveMember(options: {
  archivePath: string; archivePin: SourceBlobPin; memberPin: SourceBlobPin & { name: string };
}): Promise<Result<Buffer>> {
  try {
    if (options.memberPin.name !== 'usc18.xml') throw new Error('Unknown OLRC archive member');
    for (const pin of [options.archivePin, options.memberPin]) {
      if (!/^[a-f0-9]{64}$/.test(pin.sha256) || !Number.isSafeInteger(pin.byteLength) ||
        pin.byteLength < 1 || pin.byteLength > 128 * 1024 ** 2) throw new Error('Invalid archive/member pin');
    }
    const { stdout } = await exec('python3', [helper, '--archive', options.archivePath,
      '--archive-sha256', options.archivePin.sha256, '--archive-bytes', String(options.archivePin.byteLength),
      '--member-sha256', options.memberPin.sha256, '--member-bytes', String(options.memberPin.byteLength)],
    { encoding: 'buffer', maxBuffer: options.memberPin.byteLength + 8192, timeout: 30_000 });
    return ok(stdout);
  } catch (error: unknown) { return err(error instanceof Error ? error : new Error(String(error))); }
}

import { PublicationReceiptSchema, ok, err } from '@civic-source/types';
import type { PublicationReceipt, Result } from '@civic-source/types';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export function acceptedRoutePublication(input: { dataDirectory: string; receiptPath: string }): Result<PublicationReceipt> {
  try {
    const receipt = PublicationReceiptSchema.safeParse(JSON.parse(readFileSync(input.receiptPath, 'utf8')) as unknown);
    if (!receipt.success || !receipt.data.validationPassed || !receipt.data.requiredScopesComplete) return err(new Error('Accepted route publication unavailable'));
    const git = (args: string[]) => execFileSync('git', ['-C', input.dataDirectory, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 }).trim();
    const commit = git(['rev-parse', 'HEAD']);
    const changes = git(['status', '--porcelain', '--untracked-files=normal']);
    return commit === receipt.data.acceptedDataCommitSha && !changes
      ? ok(receipt.data) : err(new Error('Route index requires the clean accepted publication tree'));
  } catch { return err(new Error('Could not verify accepted route publication')); }
}

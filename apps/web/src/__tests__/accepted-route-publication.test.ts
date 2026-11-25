import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { acceptedRoutePublication } from '../lib/accepted-route-publication';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'usct-route-pin-'));
  roots.push(root);
  const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git(['init', '--quiet']);
  writeFileSync(join(root, 'statute.md'), 'retained');
  git(['add', 'statute.md']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture']);
  const receipt = JSON.parse(readFileSync(new URL('../../public/publication-receipt.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  receipt['acceptedDataCommitSha'] = git(['rev-parse', 'HEAD']);
  const receiptPath = join(tmpdir(), `usct-route-receipt-${root.split('/').at(-1)}.json`);
  writeFileSync(receiptPath, JSON.stringify(receipt));
  roots.push(receiptPath);
  return { root, receiptPath, receipt };
}

describe('accepted route publication binding', () => {
  it('accepts only the clean actual commit, refusing tracked edits and untracked statute additions', () => {
    const value = fixture();
    const input = { dataDirectory: value.root, receiptPath: value.receiptPath };
    expect(acceptedRoutePublication(input).ok).toBe(true);
    writeFileSync(join(value.root, 'new-statute.md'), 'uncommitted statute');
    expect(acceptedRoutePublication(input).ok).toBe(false);
    rmSync(join(value.root, 'new-statute.md'));
    writeFileSync(join(value.root, 'statute.md'), 'changed');
    expect(acceptedRoutePublication(input).ok).toBe(false);
  });
  it('refuses a mismatched commit or an unaccepted publication receipt', () => {
    const value = fixture();
    const input = { dataDirectory: value.root, receiptPath: value.receiptPath };
    writeFileSync(value.receiptPath, JSON.stringify({ ...value.receipt, acceptedDataCommitSha: '0'.repeat(40) }));
    expect(acceptedRoutePublication(input).ok).toBe(false);
    writeFileSync(value.receiptPath, JSON.stringify({ ...value.receipt, validationPassed: false }));
    expect(acceptedRoutePublication(input).ok).toBe(false);
  });
});

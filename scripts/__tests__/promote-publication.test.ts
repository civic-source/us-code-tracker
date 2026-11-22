import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  validateDataCandidate,
  promoteValidatedDataCandidate,
  verifyPublicationPinMatch,
  rollbackToPredecessorPublication,
  getTrackerSubmodulePin,
} from '../promote-publication.js';

const execFileAsync = promisify(execFile);

describe('USCT-033: Validated data-to-site publication handoff, pin update, and rollback', () => {
  let rootDir = '';
  let dataRepo = '';
  let trackerRepo = '';

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'usct-033-'));
    dataRepo = join(rootDir, 'us-code');
    trackerRepo = join(rootDir, 'us-code-tracker');
    await mkdir(dataRepo, { recursive: true });
    await mkdir(trackerRepo, { recursive: true });

    // Initialize disposable us-code data repository
    await execFileAsync('git', ['init'], { cwd: dataRepo });
    await execFileAsync('git', ['config', 'user.email', 'test@civic-source.org'], { cwd: dataRepo });
    await execFileAsync('git', ['config', 'user.name', 'Civic Source Test'], { cwd: dataRepo });

    // Initialize disposable us-code-tracker repository
    await execFileAsync('git', ['init'], { cwd: trackerRepo });
    await execFileAsync('git', ['config', 'user.email', 'test@civic-source.org'], { cwd: trackerRepo });
    await execFileAsync('git', ['config', 'user.name', 'Civic Source Test'], { cwd: trackerRepo });
    await writeFile(join(trackerRepo, 'README.md'), '# Tracker\n', 'utf-8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: trackerRepo });
    await execFileAsync('git', ['commit', '-m', 'chore: init tracker'], { cwd: trackerRepo });
  });

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('promotes a validated data update, updates the exact submodule gitlink pin, verifies receipt, rejects failed/stale candidates, and rolls back to predecessor', async () => {
    // 1. Create Release 1 (pl-119-1) in dataRepo
    const s1Dir = join(dataRepo, 'statutes', 'title-18', 'chapter-7');
    await mkdir(s1Dir, { recursive: true });
    await writeFile(join(s1Dir, 'section-111.md'), '# Section 111 (PL 119-1)\nText v1\n', 'utf-8');
    await writeFile(
      join(dataRepo, '.import-state.json'),
      JSON.stringify({ lastCompletedReleasePoint: '119-1', incompleteReleases: [] }),
      'utf-8'
    );
    await execFileAsync('git', ['add', '-A'], { cwd: dataRepo });
    await execFileAsync('git', ['commit', '-m', 'chore(law): Update to PL 119-1'], { cwd: dataRepo });
    await execFileAsync('git', ['tag', 'pl-119-1'], { cwd: dataRepo });
    const { stdout: sha1Out } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dataRepo });
    const sha1 = sha1Out.trim();

    // Promote Release 1
    const promo1 = await promoteValidatedDataCandidate({
      trackerRepoPath: trackerRepo,
      dataRepoPath: dataRepo,
      targetRef: 'pl-119-1',
      nowIso: '2026-11-21T10:00:00.000Z',
    });
    expect(promo1.ok).toBe(true);
    if (!promo1.ok) return;

    expect(promo1.value.acceptedDataCommitSha).toBe(sha1);
    expect(promo1.value.trackerSubmodulePinSha).toBe(sha1);
    expect(promo1.value.acceptedDataTag).toBe('pl-119-1');
    expect(await getTrackerSubmodulePin(trackerRepo)).toBe(sha1);

    const verify1 = await verifyPublicationPinMatch({
      trackerRepoPath: trackerRepo,
      expectedDataCommitSha: sha1,
    });
    expect(verify1.ok).toBe(true);

    // 2. Create Release 2 (pl-119-2) in dataRepo (valid data-only correction)
    await writeFile(join(s1Dir, 'section-111.md'), '# Section 111 (PL 119-2)\nText v2 corrected\n', 'utf-8');
    await writeFile(
      join(dataRepo, '.import-state.json'),
      JSON.stringify({ lastCompletedReleasePoint: '119-2', incompleteReleases: [] }),
      'utf-8'
    );
    await execFileAsync('git', ['add', '-A'], { cwd: dataRepo });
    await execFileAsync('git', ['commit', '-m', 'chore(law): Update to PL 119-2'], { cwd: dataRepo });
    await execFileAsync('git', ['tag', 'pl-119-2'], { cwd: dataRepo });
    const { stdout: sha2Out } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dataRepo });
    const sha2 = sha2Out.trim();

    // Before promotion, verifying against sha2 must FAIL because the tracker is still pinned to sha1 (stale pin!)
    const staleVerify = await verifyPublicationPinMatch({
      trackerRepoPath: trackerRepo,
      expectedDataCommitSha: sha2,
    });
    expect(staleVerify.ok).toBe(false);

    // Promote Release 2
    const promo2 = await promoteValidatedDataCandidate({
      trackerRepoPath: trackerRepo,
      dataRepoPath: dataRepo,
      targetRef: 'HEAD',
      nowIso: '2026-11-21T11:00:00.000Z',
    });
    expect(promo2.ok).toBe(true);
    if (!promo2.ok) return;

    expect(promo2.value.acceptedDataCommitSha).toBe(sha2);
    expect(promo2.value.trackerSubmodulePinSha).toBe(sha2);
    expect(promo2.value.predecessorPublicationId).toBe(promo1.value.publicationId);
    expect(promo2.value.predecessorDataCommitSha).toBe(sha1);
    expect(await getTrackerSubmodulePin(trackerRepo)).toBe(sha2);

    const verify2 = await verifyPublicationPinMatch({
      trackerRepoPath: trackerRepo,
      expectedDataCommitSha: sha2,
    });
    expect(verify2.ok).toBe(true);

    // 3. Inject a failed/incomplete candidate (R3 with incompleteReleases: ['119-3']) -> promotion MUST reject it!
    await writeFile(
      join(dataRepo, '.import-state.json'),
      JSON.stringify({ lastCompletedReleasePoint: '119-2', incompleteReleases: ['119-3'] }),
      'utf-8'
    );
    await execFileAsync('git', ['add', '-A'], { cwd: dataRepo });
    await execFileAsync('git', ['commit', '-m', 'WIP broken import 119-3'], { cwd: dataRepo });

    const invalidCheck = await validateDataCandidate(dataRepo, 'HEAD');
    expect(invalidCheck.ok).toBe(false);

    const rejectedPromo = await promoteValidatedDataCandidate({
      trackerRepoPath: trackerRepo,
      dataRepoPath: dataRepo,
      targetRef: 'HEAD',
    });
    expect(rejectedPromo.ok).toBe(false);
    // Active pin and receipt remain untouched at sha2!
    expect(await getTrackerSubmodulePin(trackerRepo)).toBe(sha2);

    // 4. Inject a stale gitlink pin mismatch in tracker index -> verifyPublicationPinMatch MUST reject it!
    await execFileAsync(
      'git',
      ['update-index', '--add', '--cacheinfo', `160000,${sha1},apps/web/content-data`],
      { cwd: trackerRepo }
    );
    const mismatchVerify = await verifyPublicationPinMatch({
      trackerRepoPath: trackerRepo,
    });
    expect(mismatchVerify.ok).toBe(false);
    if (!mismatchVerify.ok) {
      expect(mismatchVerify.error.message).toContain('Stale submodule pin detected');
    }

    // 5. Roll back from Release 2 to Release 1 -> restores sha1 pin and receipt without moving tags
    const rollbackRes = await rollbackToPredecessorPublication({
      trackerRepoPath: trackerRepo,
    });
    expect(rollbackRes.ok).toBe(true);
    if (!rollbackRes.ok) return;
    expect(rollbackRes.value.acceptedDataCommitSha).toBe(sha1);
    expect(await getTrackerSubmodulePin(trackerRepo)).toBe(sha1);

    const verifyAfterRollback = await verifyPublicationPinMatch({
      trackerRepoPath: trackerRepo,
      expectedDataCommitSha: sha1,
    });
    expect(verifyAfterRollback.ok).toBe(true);
  });
});

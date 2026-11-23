import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { ok, err } from '@civic-source/types';
import {
  listPublishedReleaseTags,
  parseChangedStatutePaths,
  resolvePendingReleases,
  runSyncLatestRelease,
  writeSyncOutputs,
} from '../sync-latest-release.js';
import type { ImportState, TitleFetch } from '../lib/import-helpers.js';
import type { ReleasePointId } from '../lib/release-points.js';

const execFileAsync = promisify(execFile);

function makeUslmXml(sectionText: string, secondSectionText?: string): string {
  const secondSection = secondSectionText
    ? `
      <section identifier="/us/usc/t18/s1002">
        <num value="1002">§ 1002.</num>
        <heading>Possession of false papers to defraud United States</heading>
        <content>${secondSectionText}</content>
      </section>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<lawDoc xmlns="http://xml.house.gov/schemas/uslm/1.0">
  <title identifier="/us/usc/t18">
    <num value="18">Title 18</num>
    <heading>CRIMES</heading>
    <chapter identifier="/us/usc/t18/ch47">
      <num value="47">CHAPTER 47</num>
      <section identifier="/us/usc/t18/s1001">
        <num value="1001">§ 1001.</num>
        <heading>Statements or entries generally</heading>
        <subsection identifier="/us/usc/t18/s1001/a">
          <num value="a">(a)</num>
          <content>${sectionText}</content>
        </subsection>
      </section>${secondSection}
    </chapter>
  </title>
</lawDoc>`;
}

function makeTitle10Xml(sectionText: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<lawDoc xmlns="http://xml.house.gov/schemas/uslm/1.0">
  <title identifier="/us/usc/t10">
    <num value="10">Title 10</num>
    <heading>ARMED FORCES</heading>
    <chapter identifier="/us/usc/t10/ch1">
      <num value="1">CHAPTER 1</num>
      <section identifier="/us/usc/t10/s101">
        <num value="101">§ 101.</num>
        <heading>Definitions</heading>
        <content>${sectionText}</content>
      </section>
    </chapter>
  </title>
</lawDoc>`;
}

describe('sync-latest-release (civic-source/us-code-tracker#326)', () => {
  let repoDir = '';

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'usct-sync-test-'));
    await execFileAsync('git', ['init'], { cwd: repoDir });
    await execFileAsync('git', ['config', 'user.email', 'test@civic-source.org'], { cwd: repoDir });
    await execFileAsync('git', ['config', 'user.name', 'Civic Source Test'], { cwd: repoDir });
    await writeFile(
      join(repoDir, '.import-state.json'),
      JSON.stringify({ lastCompletedReleasePoint: '119-59', manifests: {} }, null, 2),
      'utf-8'
    );
    await execFileAsync('git', ['add', '.import-state.json'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'chore: init pl-119-73'], { cwd: repoDir });
    await execFileAsync('git', ['tag', 'pl-119-73'], { cwd: repoDir });
  });

  afterEach(async () => {
    if (repoDir) {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  it('resolvePendingReleases skips already-tagged releases even when lastCompletedReleasePoint lags behind', () => {
    const points: ReleasePointId[] = [
      { congress: 119, law: 73, lawSegment: '73', label: 'PL 119-73' },
      { congress: 119, law: 83, lawSegment: '83', label: 'PL 119-83' },
      { congress: 119, law: 102, lawSegment: '102not101', exclusions: ['101'], label: 'PL 119-102not101' },
    ];
    const state: ImportState = { lastCompletedReleasePoint: '119-59', manifests: {} };
    const existingTags = new Set(['pl-119-73']);

    const pending = resolvePendingReleases(points, state, existingTags);
    expect(pending.map((p) => p.label)).toEqual(['PL 119-83', 'PL 119-102not101']);
  });

  it('parseChangedStatutePaths deduplicates and ignores non-statute files', () => {
    const parsed = parseChangedStatutePaths([
      '.import-state.json',
      'statutes/title-18/chapter-47/section-1001.md',
      'statutes/title-18/chapter-47/section-1001.md',
      'statutes/title-18a/chapter-1/section-451a.md',
      'annotations/title-18/section-1001.yaml',
    ]);
    expect(parsed).toEqual([
      {
        path: 'statutes/title-18/chapter-47/section-1001.md',
        title: '18',
        section: '1001',
        citation: '18 U.S.C. 1001',
      },
      {
        path: 'statutes/title-18a/chapter-1/section-451a.md',
        title: '18a',
        section: '451a',
        citation: '18a U.S.C. 451a',
      },
    ]);
  });

  it('dry-run detects pending releases without modifying repo commits or tags', async () => {
    const envFile = join(repoDir, 'github-output.txt');
    const res = await runSyncLatestRelease({
      repoPath: repoDir,
      dryRun: true,
      scrapeFn: async () => [
        { congress: 119, law: 73, lawSegment: '73', label: 'PL 119-73' },
        { congress: 119, law: 83, lawSegment: '83', label: 'PL 119-83' },
      ],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.hasChanges).toBe(true);
    expect(res.value.dryRun).toBe(true);
    expect(res.value.pendingReleaseLabels).toEqual(['PL 119-83']);
    expect(res.value.createdTags).toEqual([]);

    await writeSyncOutputs(envFile, res.value);
    const written = await readFile(envFile, 'utf-8');
    expect(written).toContain('has_changes=true');
    expect(written).toContain('latest_slug=pl-119-83');
  });

  it('imports new release, commits state cleanly, bounds annotations to changed sections, and ignores unchanged sections', async () => {
    await mkdir(join(repoDir, 'statutes/title-10/chapter-1'), { recursive: true });
    await writeFile(join(repoDir, 'statutes/title-10/chapter-1/section-101.md'), '# Unchanged\n', 'utf-8');
    await execFileAsync('git', ['add', 'statutes'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'chore: seed unchanged title 10'], { cwd: repoDir });
    await execFileAsync('git', ['tag', '-f', 'pl-119-73'], { cwd: repoDir });

    const annotatedCitations: string[] = [];
    const mockFetcher = async (rp: ReleasePointId, paddedTitle: string): Promise<TitleFetch> => {
      if (paddedTitle === '18') {
        return { kind: 'ok', xml: makeUslmXml(`Updated under ${rp.label}`) };
      }
      return { kind: 'absent' };
    };

    const res = await runSyncLatestRelease({
      repoPath: repoDir,
      dryRun: false,
      maxAnnotations: 1,
      interTitleDelayMs: 0,
      scrapeFn: async () => [
        { congress: 119, law: 73, lawSegment: '73', label: 'PL 119-73' },
        { congress: 119, law: 83, lawSegment: '83', label: 'PL 119-83' },
      ],
      fetcherFn: mockFetcher,
      annotateFn: async (citation) => {
        annotatedCitations.push(citation);
        return ok({
          path: 'annotations/title-18/section-1001.yaml',
          yaml: 'section: 18 U.S.C. 1001\ncases: []\n',
        });
      },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.hasChanges).toBe(true);
    expect(res.value.createdTags).toEqual(['pl-119-83']);
    expect(res.value.sectionsChangedCount).toBe(1);
    expect(res.value.annotatedCount).toBe(1);
    expect(annotatedCitations).toEqual(['18 U.S.C. 1001']);

    const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: repoDir });
    expect(status.stdout.trim()).toBe('');
  }, 15_000);

  it('ignores frontmatter-noise-only edits and enforces maxAnnotations cap on genuinely changed sections', async () => {
    const rp73: ReleasePointId = { congress: 119, law: 73, lawSegment: '73', label: 'PL 119-73' };
    const rp83: ReleasePointId = { congress: 119, law: 83, lawSegment: '83', label: 'PL 119-83' };
    await execFileAsync('git', ['tag', '-d', 'pl-119-73'], { cwd: repoDir });

    // Seed baseline statutes generated by real XmlToMarkdownAdapter via PL 119-73
    const baselineRes = await runSyncLatestRelease({
      repoPath: repoDir,
      dryRun: false,
      skipAnnotations: true,
      interTitleDelayMs: 0,
      scrapeFn: async () => [rp73],
      fetcherFn: async (_rp, title): Promise<TitleFetch> => {
        if (title === '10') return { kind: 'ok', xml: makeTitle10Xml('Unchanged defense definition') };
        if (title === '18') return { kind: 'ok', xml: makeUslmXml('Baseline 1001 text', 'Baseline 1002 text') };
        return { kind: 'absent' };
      },
    });
    expect(baselineRes.ok).toBe(true);

    // Ensure wall-clock generated_at timestamp advances before PL 119-83 rewrite
    await new Promise((r) => setTimeout(r, 15));

    const annotatedCitations: string[] = [];
    const syncRes = await runSyncLatestRelease({
      repoPath: repoDir,
      dryRun: false,
      maxAnnotations: 1,
      interTitleDelayMs: 0,
      scrapeFn: async () => [rp73, rp83],
      fetcherFn: async (rp, title): Promise<TitleFetch> => {
        if (title === '10') return { kind: 'ok', xml: makeTitle10Xml('Unchanged defense definition') };
        if (title === '18') return { kind: 'ok', xml: makeUslmXml(`Amended in ${rp.label}`, `Also amended in ${rp.label}`) };
        return { kind: 'absent' };
      },
      annotateFn: async (citation) => {
        annotatedCitations.push(citation);
        return ok({
          path: `annotations/title-18/section-${citation.split(' ').pop()}.yaml`,
          yaml: `section: ${citation}\ncases: []\n`,
        });
      },
    });

    expect(syncRes.ok).toBe(true);
    if (!syncRes.ok) return;
    expect(syncRes.value.sectionsChangedCount).toBe(2);
    expect(syncRes.value.annotatedCount).toBe(1);
    expect(annotatedCitations).toEqual(['18 U.S.C. 1001']);
  }, 15_000);

  it('skips default annotation gracefully when COURTLISTENER_API_TOKEN is unset', async () => {
    const prevToken = process.env.COURTLISTENER_API_TOKEN;
    delete process.env.COURTLISTENER_API_TOKEN;
    try {
      const res = await runSyncLatestRelease({
        repoPath: repoDir,
        dryRun: false,
        interTitleDelayMs: 0,
        scrapeFn: async () => [{ congress: 119, law: 83, lawSegment: '83', label: 'PL 119-83' }],
        fetcherFn: async (_rp, title) =>
          title === '18' ? { kind: 'ok', xml: makeUslmXml('Updated without token') } : { kind: 'absent' },
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.hasChanges).toBe(true);
      expect(res.value.annotatedCount).toBe(0);
      expect(res.value.annotationFailures).toBe(0);
    } finally {
      if (prevToken !== undefined) process.env.COURTLISTENER_API_TOKEN = prevToken;
    }
  }, 15_000);

  it('does not let unmerged pl-* tags on side branches suppress pending detection on main', async () => {
    await execFileAsync('git', ['checkout', '-b', 'chore/unmerged-sync'], { cwd: repoDir });
    await writeFile(join(repoDir, 'unmerged.txt'), 'draft\n', 'utf-8');
    await execFileAsync('git', ['add', 'unmerged.txt'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'chore: unmerged sync draft'], { cwd: repoDir });
    await execFileAsync('git', ['tag', 'pl-119-83'], { cwd: repoDir });
    await execFileAsync('git', ['checkout', '-'], { cwd: repoDir });

    const tags = await listPublishedReleaseTags(repoDir);
    expect(tags.has('pl-119-73')).toBe(true);
    expect(tags.has('pl-119-83')).toBe(false);

    const res = await runSyncLatestRelease({
      repoPath: repoDir,
      dryRun: true,
      scrapeFn: async () => [
        { congress: 119, law: 73, lawSegment: '73', label: 'PL 119-73' },
        { congress: 119, law: 83, lawSegment: '83', label: 'PL 119-83' },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.hasChanges).toBe(true);
    expect(res.value.pendingReleaseLabels).toEqual(['PL 119-83']);
  }, 15_000);

  it('returns err cleanly when a title fetch fails and propagates annotation errors cleanly', async () => {
    const failRes = await runSyncLatestRelease({
      repoPath: repoDir,
      dryRun: false,
      interTitleDelayMs: 0,
      scrapeFn: async () => [{ congress: 119, law: 83, lawSegment: '83', label: 'PL 119-83' }],
      fetcherFn: async (_rp, title): Promise<TitleFetch> =>
        title === '18' ? { kind: 'failed', reason: 'OLRC timeout' } : { kind: 'absent' },
    });
    expect(failRes.ok).toBe(false);

    const res = await runSyncLatestRelease({
      repoPath: repoDir,
      dryRun: false,
      interTitleDelayMs: 0,
      scrapeFn: async () => [{ congress: 119, law: 83, lawSegment: '83', label: 'PL 119-83' }],
      fetcherFn: async (_rp, title) =>
        title === '18' ? { kind: 'ok', xml: makeUslmXml('Updated text') } : { kind: 'absent' },
      annotateFn: async () => err(new Error('HTTP 429 rate limited')),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.annotatedCount).toBe(0);
    expect(res.value.annotationFailures).toBe(1);
  }, 15_000);
});

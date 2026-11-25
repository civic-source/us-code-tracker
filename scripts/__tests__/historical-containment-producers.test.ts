import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { buildCanonicalVerticalSlice, writeCuratedTopicDatasets, writeStaticNeighborhoodShards } from '../lib/canonical-vertical-slice.js';
import { buildHistoricalSearchShards } from '../lib/workbench-catalog.js';

const exec = promisify(execFile);
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

async function retainedLegacyCohort() {
  const root = await mkdtemp(join(tmpdir(), 'historical-producer-'));
  directories.push(root);
  const repo = join(root, 'corpus');
  await mkdir(repo);
  await exec('git', ['init', '-q', repo]);
  for (const [chapter, section] of [['1', '2'], ['19', '371'], ['63', '1341'], ['63', '1343'], ['95', '1951'], ['96', '1962']]) {
    const target = join(repo, `statutes/title-18/chapter-${chapter}/section-${section}.md`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `# Legacy control ${section}\n\nUnrelated retained cohort text.\n`);
  }
  await exec('git', ['-C', repo, 'add', 'statutes']);
  await exec('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']);
  await exec('git', ['-C', repo, 'tag', 'pl-116-220']);
  await exec('git', ['-C', repo, 'tag', 'pl-119-73']);
  return { root, repo };
}

describe('constructed history producer containment', () => {
  it('exports the six retained legacy controls with partial coverage after source withdrawal', async () => {
    const { root, repo } = await retainedLegacyCohort();
    const { catalog } = await buildCanonicalVerticalSlice({ sliceDir: join(root, 'cas'), dataRepoPath: repo });
    const { manifest, shards } = buildHistoricalSearchShards(catalog, 'publication-control');
    expect(catalog.getSnapshot().releases.every((release) => release.legacyDerived && release.publisherReleaseLabel.includes('legacy-derived'))).toBe(true);
    expect(manifest.sourceGaps).toHaveLength(4);
    expect(manifest.sourceGaps?.[0]?.sourceUrl).toBe('https://uscode.house.gov/download/download.shtml');
    expect(manifest.availableReleases.map((release) => release.coverageState)).toEqual(['partial', 'partial']);
    for (const shard of shards.values()) {
      expect(shard.entries.map((entry) => entry.uscSection)).toEqual(['2', '371', '1341', '1343', '1951', '1962']);
      expect(shard.entries.every((entry) => entry.legacyDerived)).toBe(true);
    }
  });
  it('does not republish withdrawn history through independently constructed topic claims and events', async () => {
    const { root, repo } = await retainedLegacyCohort();
    const { catalog } = await buildCanonicalVerticalSlice({ sliceDir: join(root, 'cas'), dataRepoPath: repo });
    const [topic] = await writeCuratedTopicDatasets(catalog, join(root, 'topics'));
    expect(topic?.memberProvisions.map((member) => member.provisionId)).toEqual([
      'prov-18-371', 'prov-18-1341', 'prov-18-1343',
    ]);
    expect(topic?.relatedAuthorities).toEqual([]);
    expect(topic?.changeEvents.map((event) => event.eventKind)).toEqual(['source_conflict_quarantine']);
    expect(topic?.changeEvents[0]?.eventId).toBe('evt-constructed-history-withdrawal-v1');
  });

  it('replaces prior direct relationship shards with explicit source gaps while retaining legacy shards', async () => {
    const { root, repo } = await retainedLegacyCohort();
    const { catalog } = await buildCanonicalVerticalSlice({ sliceDir: join(root, 'cas'), dataRepoPath: repo });
    const output = join(root, 'neighborhoods');
    await mkdir(join(output, 'pl-119-73'), { recursive: true });
    await writeFile(join(output, 'pl-119-73/18-1001.json'), JSON.stringify({ edges: [{ propositionText: 'withdrawn' }] }));
    const result = await writeStaticNeighborhoodShards(catalog, output);
    const withdrawn: unknown = JSON.parse(await readFile(join(output, 'pl-119-73/18-1001.json'), 'utf8'));
    expect(withdrawn).toMatchObject({ availability: 'source_gap', edges: [], sourceCorrection: {
      eventId: 'evt-constructed-history-withdrawal-v1',
    } });
    expect(result.shardCount).toBe(12);
    expect(result.shards['pl-119-73/18-371.json']?.edges).toEqual([]);
  });
});

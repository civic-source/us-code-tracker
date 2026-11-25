import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProvisionVersionSchema } from '@civic-source/types';
import { reviewedHistoricalVersions } from '../lib/historical-qualification.js';
import manifest from '../../apps/web/public/search-shards/manifest.json' with { type: 'json' };
import { requireHistoricalQualification } from '../lib/historical-qualification.js';
import type { HistoricalSearchShard } from '../lib/workbench-catalog.js';

describe('tracked historical publication bundle', () => {
  it('publishes only the complete selected closure, retaining legacy6x2 and twelve retained/new exact reviewed source rows', async () => {
    const root = 'apps/web/public/search-shards';
    const selected = ['manifest.json', ...Object.values(manifest.shards).map(item => item.shardPath.split('/').at(-1)!)].sort();
    expect((await readdir(root)).filter(name => name.endsWith('.json')).sort()).toEqual(selected);
    expect(manifest.availableReleases).toHaveLength(6);
    let legacy = 0; let genuine = 0;
    for (const shardMeta of Object.values(manifest.shards)) {
      const shard = JSON.parse(await readFile(join('apps/web/public', shardMeta.shardPath), 'utf8')) as HistoricalSearchShard;
      if (shard.releaseId.startsWith('pl-')) {
        expect(shard.entries).toHaveLength(6);
        expect(shard.entries.every(entry => entry.legacyDerived && !entry.sourceQualification)).toBe(true);
        legacy += shard.entries.length;
      } else for (const entry of shard.entries) {
        const version = reviewedHistoricalVersions().find(item => item.provisionVersionId === entry.provisionVersionId)!;
        requireHistoricalQualification(ProvisionVersionSchema.parse(version));
        expect(entry.bodyMarkdown).toBe(version.bodyMarkdown);
        expect(entry.renderedHtml).toBe(version.renderedHtml);
        expect(entry.notes).toEqual(version.notes);
        expect(entry.sourceCredits).toEqual(version.sourceCredits);
        expect(entry.sourceQualification).toEqual(version.sourceQualification);
        expect(entry.publisherReleaseId).toBe(version.sourceQualification.releaseId);
        expect(entry.historicalUrl).toBe(`/us-code-tracker/history/collection/${entry.releaseId}/18/${entry.uscSection}/`);
        genuine++;
      }
    }
    expect([legacy, genuine]).toEqual([12, 12]);
  });
});

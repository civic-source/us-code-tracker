import { SourceReleaseSchema } from '@civic-source/types';
import { describe, expect, it } from 'vitest';
import { CanonicalWorkbenchCatalog, buildHistoricalSearchShards } from '../lib/workbench-catalog.js';
import { withGenuineHistoricalSources } from '../lib/genuine-history-catalog.js';

describe('source-qualified historical catalog and exports', () => {
  it('adds source collections without replacing an immutable retained legacy release', async () => {
    const catalog = new CanonicalWorkbenchCatalog();
    const legacy = SourceReleaseSchema.parse({ releaseId: 'pl-119-73', publisherReleaseLabel: 'legacy-derived Git cohort',
      releaseSegment: 'partial legacy cohort', congress: 119, lawIdentifier: '73', snapshotIds: [], coverageId: 'legacy-coverage',
      manifestDigest: 'a'.repeat(64), observedAt: '2026-11-22T06:30:00.000Z', legacyDerived: true });
    expect(catalog.ingestBundle({ releases: [legacy] }).ok).toBe(true);
    const acceptedLegacy = catalog.getSnapshot().releases[0];
    const bundle = await withGenuineHistoricalSources(catalog.getSnapshot());
    if (!bundle.ok) throw bundle.error;
    expect(catalog.ingestBundle(bundle.value).ok).toBe(true);
    expect(catalog.getSnapshot().releases.find(item => item.releaseId === legacy.releaseId)).toEqual(acceptedLegacy);
  });
  it('exports twelve retained/new real, independently qualified rows at immutable cold-reader routes with partial inventory coverage', async () => {
    const catalog = new CanonicalWorkbenchCatalog();
    const bundle = await withGenuineHistoricalSources(catalog.getSnapshot());
    expect(bundle.ok).toBe(true); if (!bundle.ok) return;
    expect(catalog.ingestBundle(bundle.value).ok).toBe(true);
    const { manifest, shards } = buildHistoricalSearchShards(catalog, 'publication-test');
    expect(manifest.availableReleases.map((release) => release.coverageState)).toEqual(['partial', 'partial', 'partial', 'partial']);
    expect([...shards.values()].flatMap((shard) => shard.entries)).toHaveLength(12);
    for (const shard of shards.values()) for (const entry of shard.entries) {
      expect(entry.legacyDerived).toBe(false);
      expect(entry.sourceQualification?.releaseId).toBe(entry.publisherReleaseId);
      expect(entry.historicalUrl).toBe(`/us-code-tracker/history/collection/${entry.releaseId}/18/${entry.uscSection}/`);
      expect(entry.renderedHtml).toBeTruthy();
    }
    expect(bundle.value.coverages.every((coverage) => coverage.sourceScope.endsWith('qualified-3-of-1399'))).toBe(true);
    expect(bundle.value.assertions).toEqual([]);
    expect(bundle.value.applicabilityClaims).toEqual([]);
  });
  it('rejects assigning an original version to another generation of the same publisher', async () => {
    const catalog = new CanonicalWorkbenchCatalog();
    const bundle = await withGenuineHistoricalSources(catalog.getSnapshot());
    if (!bundle.ok) throw bundle.error;
    const member = bundle.value.memberships[0]!;
    const release = bundle.value.releases.find(item => item.releaseId === member.sourceReleaseId)!;
    const sibling = bundle.value.releases.find(item => item.publisherReleaseId === release.publisherReleaseId
      && item.releaseId !== release.releaseId)!;
    expect(sibling).toBeDefined();
    member.sourceReleaseId = sibling.releaseId;
    const result = catalog.ingestBundle(bundle.value);
    expect(result.ok).toBe(false);
    expect(catalog.getSnapshot().provisionVersions).toHaveLength(0);
  });
  it('rejects assigning a qualified version to a different historical edition', async () => {
    const catalog = new CanonicalWorkbenchCatalog();
    const bundle = await withGenuineHistoricalSources(catalog.getSnapshot());
    if (!bundle.ok) throw bundle.error;
    bundle.value.memberships[0]!.sourceReleaseId = 'pl-116-220';
    expect(catalog.ingestBundle(bundle.value).ok).toBe(false);
    expect(catalog.getSnapshot().provisionVersions).toHaveLength(0);
  });
});

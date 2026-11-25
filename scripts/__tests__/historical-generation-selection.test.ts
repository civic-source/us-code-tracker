import { describe, expect, it, vi } from 'vitest';
import { ProvisionVersionSchema } from '@civic-source/types';
import original from '../../data/olrc-history-pilot/materializations.json' with { type: 'json' };
import { readReviewedHistoricalVersions, readActiveHistoricalVersions } from '../lib/genuine-history-catalog.js';
import { historicalMembership, readHistoricalGenerations } from '../lib/historical-qualification.js';

const recipe = vi.hoisted(() => ({ value: '' }));
vi.mock('../lib/olrc-history-materialize.js', () => ({ historicalRecipeDigest: async () => recipe.value }));

describe('retained qualification versus current active producer', () => {
  it('refuses recipe drift without erasing or requalifying original source records', async () => {
    recipe.value = 'f'.repeat(64);
    await expect(readReviewedHistoricalVersions()).rejects.toThrow('recipe changed');
    const retained = readHistoricalGenerations().generations.flatMap(item => item.versions);
    for (const row of original.records) {
      expect(retained.find(version => version.provisionVersionId === row.version.provisionVersionId)).toEqual(row.version);
    }
  });

  it('selects exactly six active records while original memberships stay in their own generation', async () => {
    const registry = readHistoricalGenerations();
    recipe.value = registry.active['pl-119-73']!;
    expect(registry.active['pl-119-142']).toBe(recipe.value);
    const active = await readActiveHistoricalVersions();
    expect(active).toHaveLength(6);
    expect(active.every(version => version.sourceQualification!.recipeSha256 === recipe.value)).toBe(true);
    const originalRecipe = original.records[0]!.version.sourceQualification.recipeSha256;
    const originalCollections = registry.generations.find(item => item.recipeSha256 === originalRecipe)!.collections;
    for (const row of original.records) {
      const expected = originalCollections.find(item => item.publisherReleaseId === row.version.sourceQualification.releaseId)!;
      expect(historicalMembership(ProvisionVersionSchema.parse(row.version)).sourceReleaseId).toBe(expected.releaseId);
    }
  });
});

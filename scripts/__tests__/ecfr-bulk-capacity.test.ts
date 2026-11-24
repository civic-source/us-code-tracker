import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkStoreCapacity, inspectStoreCapacity } from '../lib/ecfr-bulk-capacity.js';

const roots: string[] = [];
async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ecfr-capacity-'));
  roots.push(root);
  return root;
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('eCFR cache capacity diagnostics', () => {
  it('reports nested retained bytes, measured free space, quota and reserve without mutating files', async () => {
    const root = await directory();
    await mkdir(join(root, 'objects'));
    await writeFile(join(root, 'objects', 'one'), 'abc');
    await writeFile(join(root, 'two'), '1234');
    const result = await inspectStoreCapacity(root, { minFreeBytes: 5, maxCacheBytes: 100, capacityProvider: async () => 42 });
    expect(result).toEqual({ ok: true, value: { cacheBytes: 7, freeBytes: 42, minFreeBytes: 5, maxCacheBytes: 100 } });
  });

  it('accepts a budget at the reserve and quota boundaries and refuses either shortage', async () => {
    const root = await directory();
    await writeFile(join(root, 'retained'), '1234567');
    const options = { minFreeBytes: 5, maxCacheBytes: 8, capacityProvider: async () => 6 };
    expect((await checkStoreCapacity(root, 1, options)).ok).toBe(true);
    const quota = await checkStoreCapacity(root, 2, { ...options, capacityProvider: async () => 100 });
    expect(quota.ok).toBe(false);
    if (!quota.ok) expect(quota.error.message).toMatch(/quota/);
    const space = await checkStoreCapacity(root, 1, { ...options, capacityProvider: async () => 5 });
    expect(space.ok).toBe(false);
    if (!space.ok) expect(space.error.message).toMatch(/Insufficient disk/);
  });

  it('measures the actual cache filesystem with safe default limits', async () => {
    const result = await inspectStoreCapacity(await directory(), {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({ cacheBytes: 0, minFreeBytes: 2 * 1024 ** 3, maxCacheBytes: 16 * 1024 ** 3 });
    expect(Number.isSafeInteger(result.value.freeBytes)).toBe(true);
    expect(result.value.freeBytes).toBeGreaterThan(0);
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid measured bytes %s', async (freeBytes) => {
    const result = await inspectStoreCapacity(await directory(), { capacityProvider: async () => freeBytes });
    expect(result.ok).toBe(false);
  });

  it.each([NaN, Infinity, -1, 0.5])('rejects invalid quota, reserve and additional budgets %s', async (limit) => {
    const root = await directory();
    expect((await inspectStoreCapacity(root, { minFreeBytes: limit })).ok).toBe(false);
    expect((await inspectStoreCapacity(root, { maxCacheBytes: limit })).ok).toBe(false);
    expect((await checkStoreCapacity(root, limit, {})).ok).toBe(false);
  });

  it('refuses symlinked cache roots and nested paths rather than following them outside the cache', async () => {
    const root = await directory();
    const external = await directory();
    await writeFile(join(external, 'large'), 'external bytes');
    await symlink(external, join(root, 'linked'));
    expect((await inspectStoreCapacity(root, {})).ok).toBe(false);
    expect((await inspectStoreCapacity(join(root, 'linked'), {})).ok).toBe(false);
  });
});

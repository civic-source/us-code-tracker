import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HashStore } from '../hash-store.js';
import { HASH_STORE_DIR, HASH_STORE_FILE } from '../constants.js';

describe('HashStore.load shape guard (#238)', () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'hashstore-test-'));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  /** Write a raw hashes.json (bypassing HashStore.save) to simulate a corrupt store. */
  async function writeRawStore(contents: string): Promise<void> {
    const dir = join(base, HASH_STORE_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, HASH_STORE_FILE), contents, 'utf-8');
  }

  it('round-trips a valid store', async () => {
    const store = new HashStore(base);
    await store.setHash('k', 'abc');
    expect(await store.getHash('k')).toBe('abc');
    expect(await store.hasChanged('k', 'abc')).toBe(false);
    expect(await store.hasChanged('k', 'def')).toBe(true);
  });

  it('degrades to empty on invalid JSON (does not throw)', async () => {
    await writeRawStore('{ not valid json');
    const store = new HashStore(base);
    expect(await store.getHash('k')).toBeUndefined();
    await store.setHash('k', 'abc'); // must not throw
    expect(await store.getHash('k')).toBe('abc');
  });

  it('treats a null payload as empty instead of throwing on null[key]', async () => {
    await writeRawStore('null');
    const store = new HashStore(base);
    expect(await store.getHash('k')).toBeUndefined();
    await store.setHash('k', 'abc'); // previously threw: null[key] = ...
    expect(await store.getHash('k')).toBe('abc');
  });

  it('treats an array payload as empty so setHash is not silently lost', async () => {
    await writeRawStore('[]');
    const store = new HashStore(base);
    await store.setHash('k', 'abc');
    // With an array store, JSON.stringify would have dropped the property.
    const reopened = new HashStore(base);
    expect(await reopened.getHash('k')).toBe('abc');
  });

  it('treats a primitive payload as empty', async () => {
    await writeRawStore('42');
    const store = new HashStore(base);
    expect(await store.getHash('k')).toBeUndefined();
    await store.setHash('k', 'abc');
    expect(await store.getHash('k')).toBe('abc');
  });
});

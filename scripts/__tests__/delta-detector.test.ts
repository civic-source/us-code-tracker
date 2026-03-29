import { describe, it, expect } from 'vitest';
import { hashContent, buildManifest, detectDelta } from '../lib/delta-detector.js';

describe('hashContent', () => {
  it('returns a 64-char hex SHA-256 digest', () => {
    const hash = hashContent('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns different hashes for different content', () => {
    expect(hashContent('aaa')).not.toBe(hashContent('bbb'));
  });

  it('returns identical hashes for identical content', () => {
    expect(hashContent('same')).toBe(hashContent('same'));
  });
});

describe('buildManifest', () => {
  it('builds a map of path to content hash', () => {
    const files = [
      { path: 'a.md', content: 'alpha' },
      { path: 'b.md', content: 'beta' },
    ];
    const manifest = buildManifest(files);
    expect(manifest.size).toBe(2);
    expect(manifest.get('a.md')).toBe(hashContent('alpha'));
    expect(manifest.get('b.md')).toBe(hashContent('beta'));
  });
});

describe('detectDelta', () => {
  it('identifies changed files when content differs', () => {
    const previous = new Map([
      ['a.md', hashContent('old content')],
      ['b.md', hashContent('unchanged')],
    ]);
    const current = new Map([
      ['a.md', hashContent('new content')],
      ['b.md', hashContent('unchanged')],
    ]);

    const delta = detectDelta(previous, current);
    expect(delta.changed).toEqual(['a.md']);
    expect(delta.unchanged).toEqual(['b.md']);
    expect(delta.deleted).toEqual([]);
  });

  it('detects new files that did not exist before', () => {
    const previous = new Map([['existing.md', hashContent('old')]]);
    const current = new Map([
      ['existing.md', hashContent('old')],
      ['brand-new.md', hashContent('new stuff')],
    ]);

    const delta = detectDelta(previous, current);
    expect(delta.changed).toEqual(['brand-new.md']);
    expect(delta.unchanged).toEqual(['existing.md']);
    expect(delta.deleted).toEqual([]);
  });

  it('detects deleted files that no longer exist', () => {
    const previous = new Map([
      ['keep.md', hashContent('keep')],
      ['remove.md', hashContent('gone')],
    ]);
    const current = new Map([['keep.md', hashContent('keep')]]);

    const delta = detectDelta(previous, current);
    expect(delta.changed).toEqual([]);
    expect(delta.unchanged).toEqual(['keep.md']);
    expect(delta.deleted).toEqual(['remove.md']);
  });

  it('returns all as changed when previous is empty', () => {
    const previous = new Map<string, string>();
    const current = new Map([
      ['a.md', hashContent('a')],
      ['b.md', hashContent('b')],
    ]);

    const delta = detectDelta(previous, current);
    expect(delta.changed).toEqual(['a.md', 'b.md']);
    expect(delta.unchanged).toEqual([]);
    expect(delta.deleted).toEqual([]);
  });

  it('returns all as deleted when current is empty', () => {
    const previous = new Map([
      ['a.md', hashContent('a')],
      ['b.md', hashContent('b')],
    ]);
    const current = new Map<string, string>();

    const delta = detectDelta(previous, current);
    expect(delta.changed).toEqual([]);
    expect(delta.unchanged).toEqual([]);
    expect(delta.deleted).toEqual(['a.md', 'b.md']);
  });

  it('handles a mix of changed, new, deleted, and unchanged', () => {
    const previous = new Map([
      ['unchanged.md', hashContent('same')],
      ['modified.md', hashContent('v1')],
      ['removed.md', hashContent('bye')],
    ]);
    const current = new Map([
      ['unchanged.md', hashContent('same')],
      ['modified.md', hashContent('v2')],
      ['added.md', hashContent('hello')],
    ]);

    const delta = detectDelta(previous, current);
    expect(delta.changed).toContain('modified.md');
    expect(delta.changed).toContain('added.md');
    expect(delta.unchanged).toEqual(['unchanged.md']);
    expect(delta.deleted).toEqual(['removed.md']);
  });
});

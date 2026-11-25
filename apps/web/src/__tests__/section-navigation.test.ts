import { describe, expect, it } from 'vitest';
import { sectionNavigation, sectionSourcePath } from '../lib/section-navigation';

const entries = [
  { id: 'title-12/chapter-6/section-1', data: { usc_title: '12', usc_section: '1' } },
  { id: 'title-12/chapter-6a/section-635t', data: { usc_title: '12', usc_section: '635t' } },
  { id: 'title-12/chapter-6a/section-635z', data: { usc_title: '12', usc_section: '635z' } },
  { id: 'title-12/chapter-7/section-2', data: { usc_title: '12', usc_section: '2' } },
];

describe('literal section navigation', () => {
  it('keeps alphanumeric chapters distinct and crosses their actual boundaries', () => {
    const result = sectionNavigation([...entries].reverse());
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const value = result.value.get(entries[1]!.id);
    expect(value?.chapterSiblings.map(entry => entry.id)).toEqual([entries[1]!.id, entries[2]!.id]);
    expect(value?.prevChapterLast).toEqual(entries[0]);
    expect(value?.nextChapterFirst).toEqual(entries[3]);
    expect(result.value.get(entries[0]!.id)?.nextChapterFirst).toEqual(entries[1]);
  });
  it('refuses duplicate or contradictory route identities', () => {
    expect(sectionNavigation([...entries, entries[0]!]).ok).toBe(false);
    expect(sectionNavigation([{ ...entries[0]!, data: { usc_title: '26', usc_section: '1' } }]).ok).toBe(false);
  });
  it('uses the original case-sensitive source file path without inventing numeric chapter paths', () => {
    expect(sectionSourcePath({ id: entries[1]!.id, filePath: 'content-data/statutes/title-12/chapter-6A/section-635t.md' })).toEqual({ ok: true, value: 'statutes/title-12/chapter-6A/section-635t.md' });
    expect(sectionSourcePath({ id: entries[1]!.id, filePath: 'content-data/statutes/title-12/chapter-6/section-635t.md' }).ok).toBe(false);
    expect(sectionSourcePath({ id: entries[1]!.id }).ok).toBe(false);
  });
});

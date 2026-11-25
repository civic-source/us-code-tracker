import { compareSectionNumbers } from '@civic-source/shared';
import { ok, err } from '@civic-source/types';
import type { Result } from '@civic-source/types';
import { routeCoordinates } from './citation-routes';

interface SectionEntry { id: string; data: { usc_title: string; usc_section: string } }
interface Neighbors<T> { chapterSiblings: T[]; prevChapterLast: T | null; nextChapterFirst: T | null }

function adjacentEntry<T>(key: string, adjacent: [string, T[]] | undefined, side: 'first' | 'last'): T | null {
  if (!adjacent || adjacent[0].split('/')[0] !== key.split('/')[0]) return null;
  return (side === 'first' ? adjacent[1][0] : adjacent[1].at(-1)) ?? null;
}

export function sectionNavigation<T extends SectionEntry>(entries: readonly T[]): Result<Map<string, Neighbors<T>>> {
  const groups = new Map<string, T[]>();
  const seen = new Set<string>();
  for (const entry of entries) {
    const coordinates = routeCoordinates(entry.id);
    if (!coordinates.ok || coordinates.value.title !== entry.data.usc_title || coordinates.value.section.toLowerCase() !== entry.data.usc_section.toLowerCase()) return err(new Error('Conflicting section route'));
    if (seen.has(entry.id)) return err(new Error('Duplicate section route'));
    seen.add(entry.id);
    const key = entry.id.slice(0, entry.id.lastIndexOf('/'));
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const ordered = [...groups].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
  for (const [, group] of ordered) group.sort((a, b) => compareSectionNumbers(a.data.usc_section, b.data.usc_section));
  const result = new Map<string, Neighbors<T>>();
  for (const [index, [key, chapterSiblings]] of ordered.entries()) {
    const neighbors = { chapterSiblings, prevChapterLast: adjacentEntry(key, ordered[index - 1], 'last'), nextChapterFirst: adjacentEntry(key, ordered[index + 1], 'first') };
    for (const entry of chapterSiblings) result.set(entry.id, neighbors);
  }
  return ok(result);
}

export function sectionSourcePath(entry: { id: string; filePath?: string }): Result<string> {
  const match = /(?:^|\/)(statutes\/(title-\d+[a-z]?\/chapter-\d+[A-Za-z-]*\/section-[0-9A-Za-z-]+)\.md)$/.exec(entry.filePath ?? '');
  return match?.[1] && match[2]?.toLowerCase() === entry.id.toLowerCase()
    ? ok(match[1]) : err(new Error('Original statute source path unavailable'));
}

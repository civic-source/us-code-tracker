/** Edition-specific source witnesses are retained in docs/data/chapter-headings.json. */
export function officialChapterHeading(release: string, title: string, chapter: string): string | null {
  if (release !== 'pl-119-142' || title !== '18') return null;
  return ({ '1': 'GENERAL PROVISIONS', '7': 'ASSAULT' } as Record<string, string>)[chapter] ?? null;
}

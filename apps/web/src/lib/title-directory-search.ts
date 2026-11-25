import type { TitleCategory } from '../data/title-categories';

export interface SearchableTitle {
  num: string;
  name: string;
  category: TitleCategory;
}

const SUBJECT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  '26': ['tax'],
};

export function filterTitles<T extends SearchableTitle>(
  titles: readonly T[],
  query: string,
  category: TitleCategory | 'All',
): T[] {
  const term = query.trim().toLowerCase();
  return titles.filter((title) => {
    const subjects = [title.num, title.name, ...(SUBJECT_ALIASES[title.num] ?? [])];
    return (category === 'All' || title.category === category)
      && (!term || subjects.some((subject) => subject.toLowerCase().includes(term)));
  });
}

export const TITLE_FILTER_CATEGORIES = [
  'All',
  'Administration & Governance',
  'Judiciary & Criminal Law',
  'Commerce, Tax & Finance',
  'Health, Education & Resources',
  'Defense, Security & Foreign Affairs',
] as const;

export interface DirectoryState {
  query: string;
  category: TitleCategory | 'All';
}

export function readDirectoryState(url: URL): DirectoryState {
  const category = TITLE_FILTER_CATEGORIES.find((item) => item === url.searchParams.get('category')) ?? 'All';
  return { query: url.searchParams.get('q') ?? '', category };
}

export function writeDirectoryState(url: URL, state: DirectoryState): URL {
  const target = new URL(url);
  const query = state.query.trim();
  if (query) target.searchParams.set('q', query);
  else target.searchParams.delete('q');
  if (state.category === 'All') target.searchParams.delete('category');
  else target.searchParams.set('category', state.category);
  return target;
}

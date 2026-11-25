import { TITLE_NAMES } from '../data/title-names';

export function titleNavigation(availableTitles: readonly string[]): { id: string; name: string; available: boolean }[] {
  const available = new Set(availableTitles);
  return Object.entries(TITLE_NAMES)
    .map(([id, name]) => ({ id, name, available: available.has(id) }))
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

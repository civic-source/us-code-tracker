/** A requested edition is never silently replaced by the current publication. */
export function searchEditionScope(requested: string | null, acceptedTag: string): string {
  if (!/^pl-\d+-[0-9a-z-]+$/.test(acceptedTag)) return 'unavailable';
  if (requested === null) return 'current';
  const tag = requested.trim().toLowerCase();
  if (tag === acceptedTag) return 'current';
  return /^pl-\d+-[0-9a-z-]+$/.test(tag) ? tag : 'unavailable';
}

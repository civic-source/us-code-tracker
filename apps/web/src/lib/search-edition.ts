import { acceptedReleaseContext, isAcceptedCurrentRelease, normalizedReleaseTag } from './accepted-release-context';

/** A requested edition is never silently replaced by the current publication. */
export function searchEditionScope(requested: string | null, acceptedTag: string, retainedCollections: readonly string[] = []): string {
  if (!acceptedReleaseContext(acceptedTag)) return 'unavailable';
  if (requested === null || isAcceptedCurrentRelease(requested, acceptedTag)) return 'current';
  if (/^olrc-pilot-[a-f0-9]{64}$/.test(requested) && retainedCollections.includes(requested)) return requested;
  const tag = normalizedReleaseTag(requested);
  const context = acceptedReleaseContext(tag);
  return context && context.dataRevision === undefined ? tag : 'unavailable';
}

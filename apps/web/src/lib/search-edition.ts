import { acceptedReleaseContext, isAcceptedCurrentRelease, normalizedReleaseTag } from './accepted-release-context';

/** A requested edition is never silently replaced by the current publication. */
export function searchEditionScope(requested: string | null, acceptedTag: string): string {
  if (!acceptedReleaseContext(acceptedTag)) return 'unavailable';
  if (requested === null || isAcceptedCurrentRelease(requested, acceptedTag)) return 'current';
  const tag = normalizedReleaseTag(requested);
  const context = acceptedReleaseContext(tag);
  return context && context.dataRevision === undefined ? tag : 'unavailable';
}

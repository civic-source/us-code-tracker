export interface AcceptedReleaseContext {
  dataTag: string;
  publisherReleaseId: string;
  dataRevision?: number;
}

/** Normalize a label without removing a requested data-revision suffix. */
export function normalizedReleaseTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/^(?:public\s+law|pub\.\s*l\.?|pl)[\s-]*/, 'pl-').replace(/\s+/g, '-');
}

/** Only the trusted accepted tag establishes a publisher/revision correspondence. */
export function acceptedReleaseContext(acceptedTag: string): AcceptedReleaseContext | null {
  const dataTag = normalizedReleaseTag(acceptedTag);
  const match = /^(pl-\d+-\d+[a-z0-9]*)(?:-rev([1-9]\d*))?$/.exec(dataTag);
  if (!match?.[1]) return null;
  const dataRevision = match[2] === undefined ? undefined : Number(match[2]);
  if (dataRevision !== undefined && !Number.isSafeInteger(dataRevision)) return null;
  return { dataTag, publisherReleaseId: match[1], ...(dataRevision === undefined ? {} : { dataRevision }) };
}

export function isAcceptedCurrentRelease(requested: string, acceptedTag: string): boolean {
  const context = acceptedReleaseContext(acceptedTag);
  if (!context) return false;
  const tag = normalizedReleaseTag(requested);
  return tag === context.dataTag || tag === context.publisherReleaseId;
}

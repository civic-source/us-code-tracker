import { PublicationReceiptSchema, err } from '@civic-source/types';
import type { Result, RouteIdentity, RouteIndex } from '@civic-source/types';
import type { CitationJump } from './citation-parser';
import { fetchRouteIndex, readBoundedJson, resolveIndexedCitation, pinpointAnchor, routeCoordinates } from './citation-routes';

const cache = new Map<string, RouteIndex>();

/** Index caches include the entire accepted publication identity. */
export async function publishedCitation(jump: CitationJump, base: string, fetcher: typeof fetch = fetch): Promise<Result<string>> {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) return err(new Error('Invalid site base'));
  try {
    const response = await fetcher(`${base}publication-receipt.json`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    const raw = await readBoundedJson(response, 64 * 1024);
    if (!raw.ok) return raw;
    const receipt = PublicationReceiptSchema.safeParse(raw.value);
    if (!receipt.success || !receipt.data.validationPassed || !receipt.data.requiredScopesComplete) {
      return err(new Error('Accepted publication metadata unavailable'));
    }
    const identity: RouteIdentity = { publicationId: receipt.data.publicationId,
      acceptedDataCommitSha: receipt.data.acceptedDataCommitSha, releaseId: receipt.data.acceptedDataTag, titleId: jump.title };
    const key = JSON.stringify(identity);
    let index = cache.get(key);
    if (!index) {
      const loaded = await fetchRouteIndex(identity, base, fetcher);
      if (!loaded.ok) return loaded;
      index = loaded.value;
      cache.set(key, index);
    }
    return resolveIndexedCitation(index, identity, jump, base);
  } catch { return err(new Error('Accepted section route unavailable')); }
}

interface RetainedRoute { releaseId: string; uscTitle: string; uscSection: string; historicalUrl: string; publisherReleaseId?: string; sourceQualification?: { releaseId: string; sectionIdentifier: string }; subsectionAnchorIds?: string[] }

function retainedEdition(url: URL, release: string): boolean {
  return url.searchParams.get('release') === release && [...url.searchParams.keys()].every(key => key === 'release') && !url.hash;
}

function retainedUrl(raw: string, release: string, jump: CitationJump, base: string): Result<URL> {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base) || !raw.startsWith(`${base}statute/title-${jump.title}/`)) return err(new Error('Invalid retained route'));
  try {
    const url = new URL(raw, 'https://local.invalid');
    const coordinates = routeCoordinates(url.pathname.slice(`${base}statute/`.length).replace(/\/$/, ''));
    if (!coordinates.ok || coordinates.value.title !== jump.title || coordinates.value.section.toLowerCase() !== jump.section.toLowerCase()) return err(new Error('Retained section mismatch'));
    return retainedEdition(url, release) ? { ok: true, value: url } : err(new Error('Retained edition mismatch'));
  } catch { return err(new Error('Invalid retained URL')); }
}

export function retainedCitation(entries: readonly RetainedRoute[], release: string, jump: CitationJump, base: string): Result<string> {
  const matches = entries.filter(entry => entry.releaseId === release && entry.uscTitle === jump.title && entry.uscSection.toLowerCase() === jump.section.toLowerCase());
  if (matches.length !== 1) return err(new Error('Exact historical source unavailable or ambiguous'));
  const entry = matches[0]!;
  if (entry.sourceQualification) {
    const anchor = pinpointAnchor(jump.pinpoint);
    if (!anchor.ok) return anchor;
    const publisher = entry.publisherReleaseId ?? '';
    const coordinates = /^olrc-pilot-[a-f0-9]{64}$/.test(release) && /^pl-[0-9]+-[0-9]+$/.test(publisher) && /^[0-9]+$/.test(jump.title) && /^[0-9]+[a-z]*$/.test(jump.section);
    const expected = `${base}history/collection/${release}/${jump.title}/${jump.section}/`;
    if (!coordinates || !/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base) || entry.historicalUrl !== expected ||
      entry.sourceQualification.releaseId !== publisher || entry.sourceQualification.sectionIdentifier !== `/us/usc/t${jump.title}/s${jump.section}`) {
      return err(new Error('Source-qualified historical route identity mismatch'));
    }
    if (anchor.value && !entry.subsectionAnchorIds?.includes(anchor.value.slice(1))) return err(new Error('Pinpoint representation unavailable in this retained edition'));
    return { ok: true, value: expected + anchor.value };
  }
  const url = retainedUrl(entry.historicalUrl, release, jump, base);
  if (!url.ok) return url;
  const anchor = pinpointAnchor(jump.pinpoint);
  if (!anchor.ok) return anchor;
  return { ok: true, value: `${url.value.pathname}${url.value.search}${anchor.value}` };
}

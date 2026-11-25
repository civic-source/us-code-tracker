import { RouteIndexSchema, RouteIdentitySchema, ok, err } from '@civic-source/types';
import type { RouteIdentity, RouteIndex, Result } from '@civic-source/types';
import type { CitationJump } from './citation-parser';

export const ROUTE_INDEX_MAX_BYTES = 2 * 1024 * 1024;

export function validateRouteIndex(value: unknown): Result<RouteIndex> {
  const parsed = RouteIndexSchema.safeParse(value);
  if (!parsed.success) return err(new Error('Invalid route index'));
  const seen = new Set<string>();
  for (const entry of parsed.data.entries) {
    if (!entry.path.startsWith(`title-${parsed.data.identity.titleId}/`) ||
        !entry.path.toLowerCase().endsWith(`/section-${entry.section.toLowerCase()}`) || seen.has(entry.path)) {
      return err(new Error('Conflicting route identity'));
    }
    seen.add(entry.path);
  }
  return ok(parsed.data);
}

export function buildRouteIndex(identity: RouteIdentity, entries: readonly { id: string; section: string; disposition?: string }[]): Result<RouteIndex> {
  const result = validateRouteIndex({ schemaVersion: 'usct.route-index/v1', identity,
    entries: entries.map(entry => ({ section: entry.section, path: entry.id, disposition: entry.disposition ?? 'active' }))
      .sort((a, b) => a.path.localeCompare(b.path, 'en')) });
  if (!result.ok) return result;
  return new TextEncoder().encode(JSON.stringify(result.value)).byteLength <= ROUTE_INDEX_MAX_BYTES
    ? result : err(new Error('Route index exceeds byte budget'));
}

export function resolveIndexedCitation(index: RouteIndex, identity: RouteIdentity, jump: CitationJump, base: string): Result<string> {
  const verified = validateRouteIndex(index);
  const expected = RouteIdentitySchema.safeParse(identity);
  if (!verified.ok || !expected.success || !/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) return err(new Error('Invalid route request'));
  if (Object.entries(expected.data).some(([key, value]) => index.identity[key as keyof RouteIdentity] !== value) || jump.title !== identity.titleId) {
    return err(new Error('Requested edition or title unavailable'));
  }
  const candidates = index.entries.filter(entry => entry.section.toLowerCase() === jump.section.toLowerCase());
  if (candidates.length !== 1) return err(new Error(candidates.length ? 'Ambiguous section route' : 'Section unavailable in this edition'));
  const anchor = pinpointAnchor(jump.pinpoint);
  if (!anchor.ok) return anchor;

  return ok(`${base}statute/${candidates[0]!.path}/?release=${encodeURIComponent(identity.releaseId)}${anchor.value}`);
}

export function pinpointAnchor(parts?: readonly string[]): Result<string> {
  if (!parts?.length) return ok('');
  return parts.some(part => !/^[a-zA-Z0-9]+$/.test(part))
    ? err(new Error('Invalid pinpoint')) : ok(`#subsec-${parts.join('-')}`);
}

function validDeclaredLength(value: string | null, maximum: number): boolean {
  return value === null || (/^\d+$/.test(value) && Number(value) <= maximum);
}

function decodedLengthAgrees(response: Response, length: number): boolean {
  const encoding = response.headers.get('content-encoding');
  if (encoding && encoding !== 'identity') return true;
  const declared = response.headers.get('content-length');
  return declared === null || Number(declared) === length;
}

async function readStream(body: ReadableStream<Uint8Array>, maximum: number): Promise<Result<Uint8Array>> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        return err(new Error('Navigation metadata exceeds byte budget'));
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return ok(bytes);
  } catch { return err(new Error('Could not read navigation metadata')); }
  finally { reader.releaseLock(); }
}

export async function readBoundedJson(response: Response, maxBytes: number): Promise<Result<unknown>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > ROUTE_INDEX_MAX_BYTES) return err(new Error('Invalid metadata byte budget'));
  if (!response.ok || !response.body) return err(new Error('Navigation metadata unavailable'));
  try {
    if (!validDeclaredLength(response.headers.get('content-length'), maxBytes)) {
      await response.body.cancel();
      return err(new Error('Navigation metadata exceeds byte budget'));
    }
    const bytes = await readStream(response.body, maxBytes);
    if (!bytes.ok) return bytes;
    if (!decodedLengthAgrees(response, bytes.value.byteLength)) return err(new Error('Metadata length mismatch'));
    return ok(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.value)) as unknown);
  } catch { return err(new Error('Malformed navigation metadata')); }
}

export async function fetchRouteIndex(identity: RouteIdentity, base: string, fetcher: typeof fetch = fetch): Promise<Result<RouteIndex>> {
  if (!RouteIdentitySchema.safeParse(identity).success || !/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) return err(new Error('Invalid index identity'));
  try {
    const response = await fetcher(`${base}route-index/${identity.releaseId}/title-${identity.titleId}.json`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    const json = await readBoundedJson(response, ROUTE_INDEX_MAX_BYTES);
    if (!json.ok) return json;
    const index = validateRouteIndex(json.value);
    if (!index.ok) return index;
    return Object.entries(identity).every(([key, value]) => index.value.identity[key as keyof RouteIdentity] === value)
      ? index : err(new Error('Route index publication mismatch'));
  } catch { return err(new Error('Route index unavailable')); }
}

export function routeCoordinates(path: string): Result<{ title: string; chapter: string; section: string }> {
  const match = /^title-(\d+[a-z]?)\/chapter-(\d+[A-Za-z-]*)\/section-([0-9A-Za-z-]+)$/.exec(path);
  return match ? ok({ title: match[1]!, chapter: match[2]!, section: match[3]! }) : err(new Error('Invalid collected route'));
}

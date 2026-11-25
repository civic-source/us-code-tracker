import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import type { RouteIdentity } from '@civic-source/types';
import { resolve } from 'node:path';
import { buildRouteIndex } from '../../../lib/citation-routes';
import { acceptedRoutePublication } from '../../../lib/accepted-route-publication';

export async function getStaticPaths() {
  const publication = acceptedRoutePublication({ dataDirectory: resolve('content-data'), receiptPath: resolve('public/publication-receipt.json') });
  if (!publication.ok) throw publication.error;
  const receipt = publication.value;
  const entries = await getCollection('statutes');
  const byTitle = new Map<string, typeof entries>();
  for (const entry of entries) {
    const title = entry.data.usc_title;
    const group = byTitle.get(title) ?? [];
    group.push(entry);
    byTitle.set(title, group);
  }
  return [...byTitle].map(([titleId, members]) => {
    const identity: RouteIdentity = { publicationId: receipt.publicationId,
      acceptedDataCommitSha: receipt.acceptedDataCommitSha, releaseId: receipt.acceptedDataTag, titleId };
    const index = buildRouteIndex(identity, members.map(entry => ({ id: entry.id, section: entry.data.usc_section, disposition: entry.data.status ?? 'active' })));
    if (!index.ok) throw index.error;
    return { params: { release: identity.releaseId, title: `title-${titleId}` }, props: { index: index.value } };
  });
}

export const GET: APIRoute = ({ props }) => new Response(JSON.stringify(props['index']), {
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});

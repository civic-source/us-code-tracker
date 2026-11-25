import { describe, expect, it } from 'vitest';
import { parseCitation } from '../lib/citation-parser';
import { buildRouteIndex, resolveIndexedCitation } from '../lib/citation-routes';

const identity = { publicationId: 'pub-test', acceptedDataCommitSha: 'a'.repeat(40), releaseId: 'pl-119-142', titleId: '18' };
const entries = [{ id: 'title-18/chapter-7/section-111', section: '111' }];

describe('accepted citation routes', () => {
  it('preserves a complete pinpoint and resolves the accepted entry path and edition', () => {
    const jump = parseCitation('18 USC 111(a)(1)');
    expect(jump).toEqual({ title: '18', section: '111', pinpoint: ['a', '1'], display: '18 U.S.C. § 111(a)(1)' });
    const index = buildRouteIndex(identity, entries);
    expect(index.ok).toBe(true);
    if (!index.ok || !jump) return;
    expect(resolveIndexedCitation(index.value, identity, jump, '/us-code-tracker/')).toEqual({
      ok: true, value: '/us-code-tracker/statute/title-18/chapter-7/section-111/?release=pl-119-142#subsec-a-1',
    });
  });

  it('refuses missing, cross-title, ambiguous and mismatched-edition routes', () => {
    const index = buildRouteIndex(identity, entries);
    if (!index.ok) throw index.error;
    for (const jump of [{ title: '18', section: '999', display: '' }, { title: '26', section: '111', display: '' }]) {
      expect(resolveIndexedCitation(index.value, identity, jump, '/')).toMatchObject({ ok: false });
    }
    expect(resolveIndexedCitation(index.value, { ...identity, releaseId: 'pl-119-73' }, { title: '18', section: '111', display: '' }, '/')).toMatchObject({ ok: false });
    const ambiguous = buildRouteIndex(identity, [...entries, { id: 'title-18/chapter-9/section-111', section: '111' }]);
    if (!ambiguous.ok) throw ambiguous.error;
    expect(resolveIndexedCitation(ambiguous.value, identity, { title: '18', section: '111', display: '' }, '/')).toMatchObject({ ok: false });
  });

  it('rejects forged paths and duplicate entries without guessing a chapter', () => {
    for (const id of ['https://evil.test/section-111', '../title-18/chapter-7/section-111', 'title-26/chapter-7/section-111', 'title-18/chapter-7/section-112', 'title-18/chapter-%2f/section-111']) {
      expect(buildRouteIndex(identity, [{ id, section: '111' }])).toMatchObject({ ok: false });
    }
    expect(buildRouteIndex(identity, [...entries, ...entries])).toMatchObject({ ok: false });
  });
});

describe('bounded public route loading', () => {
  it('refuses streamed oversized responses before parsing and mismatched publication identities', async () => {
    const { fetchRouteIndex } = await import('../lib/citation-routes');
    const valid = buildRouteIndex(identity, entries);
    if (!valid.ok) throw valid.error;
    const fetcher = async () => new Response(JSON.stringify(valid.value));
    expect((await fetchRouteIndex(identity, '/', fetcher)).ok).toBe(true);
    expect((await fetchRouteIndex({ ...identity, publicationId: 'other' }, '/', fetcher)).ok).toBe(false);
    let cancelled = false;
    const oversized = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
      cancel() { cancelled = true; },
    }));
    expect((await fetchRouteIndex(identity, '/', oversized)).ok).toBe(false);
    expect(cancelled).toBe(true);
  });
});

describe('retained historical citation routes', () => {
  it('uses only an exact same-edition retained record, with no current or guessed fallback', async () => {
    const { retainedCitation } = await import('../lib/published-citation');
    const jump = { title: '18', section: '111', display: '', pinpoint: ['a', '1'] };
    const entry = { releaseId: 'pl-119-73', uscTitle: '18', uscSection: '111', historicalUrl: '/us-code-tracker/statute/title-18/chapter-7/section-111/?release=pl-119-73' };
    expect(retainedCitation([entry], 'pl-119-73', jump, '/us-code-tracker/')).toMatchObject({ ok: true, value: entry.historicalUrl + '#subsec-a-1' });
    expect(retainedCitation([], 'pl-119-73', jump, '/us-code-tracker/').ok).toBe(false);
    expect(retainedCitation([entry], 'pl-119-142', jump, '/us-code-tracker/').ok).toBe(false);
    expect(retainedCitation([entry, entry], 'pl-119-73', jump, '/us-code-tracker/').ok).toBe(false);
    expect(retainedCitation([{ ...entry, historicalUrl: 'https://evil.test/' }], 'pl-119-73', jump, '/us-code-tracker/').ok).toBe(false);
  });
});

it('retains literal alphanumeric chapter and multi-letter section identifiers', async () => {
  const { routeCoordinates } = await import('../lib/citation-routes');
  expect(routeCoordinates('title-18a/chapter-1A/section-2000bb-1')).toEqual({ ok: true, value: { title: '18a', chapter: '1A', section: '2000bb-1' } });
  expect(parseCitation('42 USC 2000bb-1')).toMatchObject({ title: '42', section: '2000bb-1' });
});

it('rejects oversized declarations, malformed UTF-8/JSON and unrecognized metadata fields', async () => {
  const { readBoundedJson, validateRouteIndex } = await import('../lib/citation-routes');
  expect((await readBoundedJson(new Response('{}', { headers: { 'content-length': '2097153' } }), 2097152)).ok).toBe(false);
  expect((await readBoundedJson(new Response(new Uint8Array([255])), 2097152)).ok).toBe(false);
  expect((await readBoundedJson(new Response('{'), 2097152)).ok).toBe(false);
  expect((await readBoundedJson(new Response('{}', { headers: { 'content-length': '1' } }), 2097152)).ok).toBe(false);
  expect((await readBoundedJson(new Response('{}'), Number.POSITIVE_INFINITY)).ok).toBe(false);
  const index = buildRouteIndex(identity, entries);
  if (!index.ok) throw index.error;
  expect(validateRouteIndex({ ...index.value, body: 'untrusted' }).ok).toBe(false);
  expect(buildRouteIndex({ ...identity, titleId: 'NaN' }, entries).ok).toBe(false);
});

it('retains publisher section case while matching the actual lowercased Astro slug', () => {
  const index = buildRouteIndex({ ...identity, titleId: '42' }, [{ id: 'title-42/chapter-8/section-1437f', section: '1437F' }]);
  expect(index.ok).toBe(true);
  if (!index.ok) throw index.error;
  expect(index.value.entries[0]?.section).toBe('1437F');
  expect(resolveIndexedCitation(index.value, { ...identity, titleId: '42' }, { title: '42', section: '1437f', display: '' }, '/')).toMatchObject({ ok: true, value: '/statute/title-42/chapter-8/section-1437f/?release=pl-119-142' });
});

it('bounds decoded bytes without comparing gzip wire length to the decoded body', async () => {
  const { createServer } = await import('node:http');
  const { gzipSync } = await import('node:zlib');
  const { readBoundedJson } = await import('../lib/citation-routes');
  const body = { schemaVersion: 'fixture', content: 'bounded'.repeat(100) };
  const compressed = gzipSync(JSON.stringify(body));
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': String(compressed.length) });
    response.end(compressed);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    expect(await readBoundedJson(response, 2097152)).toEqual({ ok: true, value: body });
    expect((await readBoundedJson(await fetch(`http://127.0.0.1:${address.port}/`), 200)).ok).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

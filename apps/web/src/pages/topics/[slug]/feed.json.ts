import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIContext } from 'astro';

export function getStaticPaths() {
  const indexPath = join(process.cwd(), 'public/topics/index.json');
  const indexData = JSON.parse(readFileSync(indexPath, 'utf-8')) as {
    topics: Array<{ topicSlug: string }>;
  };
  return indexData.topics.map((t) => ({ params: { slug: t.topicSlug } }));
}

export function GET(context: APIContext) {
  const slug = context.params.slug ?? 'false-statements-fraud';
  const raw = readFileSync(join(process.cwd(), `public/topics/${slug}.json`), 'utf-8');
  return new Response(raw, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

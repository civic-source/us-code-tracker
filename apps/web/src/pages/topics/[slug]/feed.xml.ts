import rss from '@astrojs/rss';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIContext } from 'astro';
import type { CuratedTopicDataset } from '../../../lib/types';

export function getStaticPaths() {
  const indexPath = join(process.cwd(), 'public/topics/index.json');
  const indexData = JSON.parse(readFileSync(indexPath, 'utf-8')) as {
    topics: Array<{ topicSlug: string }>;
  };
  return indexData.topics.map((t) => ({ params: { slug: t.topicSlug } }));
}

export async function GET(context: APIContext) {
  const slug = context.params.slug ?? 'false-statements-fraud';
  const topic = JSON.parse(
    readFileSync(join(process.cwd(), `public/topics/${slug}.json`), 'utf-8')
  ) as CuratedTopicDataset;

  return rss({
    title: `US Code Tracker Topic Feed — ${topic.title}`,
    description: topic.summary,
    site: context.site ?? 'https://civic-source.github.io/us-code-tracker/',
    items: topic.changeEvents.map((evt) => ({
      title: `[${evt.eventKind}] ${evt.title}`,
      pubDate: new Date(evt.occurredAt),
      link: `/us-code-tracker/topics/${topic.topicSlug}/`,
      description: `${evt.summary} (Locator: ${evt.evidenceLocator})`,
    })),
  });
}

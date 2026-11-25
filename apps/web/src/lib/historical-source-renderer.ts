import { unified } from '@astrojs/markdown-remark';
import rehypeSanitize from 'rehype-sanitize';

const processor = unified({ rehypePlugins: [rehypeSanitize] });
let renderer: ReturnType<typeof processor.createRenderer> | undefined;

/** The retained historical fragment uses the same sanitized Markdown pipeline as the reader. */
export async function renderHistoricalSource(body: string): Promise<string> {
  if (Buffer.byteLength(body) > 2 * 1024 ** 2) throw new Error('Historical section body exceeds its rendering bound');
  renderer ??= processor.createRenderer({});
  return (await (await renderer).render(body)).code;
}

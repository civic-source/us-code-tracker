import { unified } from '@astrojs/markdown-remark';
import rehypeSanitize from 'rehype-sanitize';
import { err, ok } from '@civic-source/types';
import type { Result } from '@civic-source/types';
import subsectionAnchors from './subsection-anchors.js';

export const statuteMarkdown = unified({ rehypePlugins: [rehypeSanitize] });
const anchoredMarkdown = unified({ rehypePlugins: [rehypeSanitize, subsectionAnchors] });
let renderer: ReturnType<typeof anchoredMarkdown.createRenderer> | undefined;

interface RenderedEntry { body?: string; rendered?: { html: string } }

/** Only standalone section pages receive subsection IDs; chapter rollups retain their HTML. */
export async function withSubsectionAnchors<T extends RenderedEntry>(entry: T): Promise<Result<T>> {
  if (typeof entry.body !== 'string' || !entry.rendered) return err(new Error('Statute rendering requires the retained body and compiled HTML'));
  try {
    renderer ??= anchoredMarkdown.createRenderer({});
    const compiled = await (await renderer).render(entry.body);
    return ok({ ...entry, rendered: { ...entry.rendered, html: compiled.code } });
  } catch { return err(new Error('Could not compile subsection anchors')); }
}

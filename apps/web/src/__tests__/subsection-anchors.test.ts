import { describe, expect, it } from 'vitest';
import { unified } from '@astrojs/markdown-remark';
import rehypeSanitize from 'rehype-sanitize';
import subsectionAnchors from '../lib/subsection-anchors';

async function render(source: string) {
  const renderer = await unified({ rehypePlugins: [rehypeSanitize, subsectionAnchors] }).createRenderer({});
  return (await renderer.render(source)).code;
}

describe('cold rendered subsection anchors', () => {
  it('renders unique full structural paths without JavaScript and excludes notes', async () => {
    const html = await render('# § 111. Test\n\n- **(a)** Whoever—\n  - **(1)** text\n    - **(A)** deeper\n\n## Editorial Notes\n\n- **(a)** note');
    expect(html).toContain('id="subsec-a"');
    expect(html).toContain('id="subsec-a-1"');
    expect(html).toContain('id="subsec-a-1-A"');
    expect(html.match(/id="subsec-a"/g)).toHaveLength(1);
    expect(html).toContain('<strong>(a)</strong> note');
  });
  it('withholds ambiguous duplicate anchors and never borrows a descendant marker', async () => {
    const html = await render('- unmarked parent\n  - **(a)** child\n\n- **(b)** first\n- **(b)** duplicate');
    expect(html).not.toContain('id="subsec-b"');
    expect(html).not.toContain('id="subsec-a"');
  });
});

it('clones only rendered HTML and preserves the accepted body and every sanitized output byte apart from IDs', async () => {
  const { withSubsectionAnchors, statuteMarkdown } = await import('../lib/anchored-entry');
  const renderer = await statuteMarkdown.createRenderer({});
  const body = '# § 111. Test\n\n- **(a)** Whoever—\n  - **(1)** text\n\n## Notes\n\n- **(a)** note';
  const baseline = await renderer.render(body);
  const entry = { body, rendered: { html: baseline.code, metadata: { witness: 'preserved' } }, id: 'title-18/chapter-7/section-111' };
  const result = await withSubsectionAnchors(entry);
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value.body).toBe(body);
  expect(result.value.rendered.metadata).toEqual(entry.rendered.metadata);
  expect(entry.rendered.html).toBe(baseline.code);
  expect(result.value.rendered.html.replace(/ id="subsec-[A-Za-z0-9-]+"/g, '')).toBe(baseline.code);
});

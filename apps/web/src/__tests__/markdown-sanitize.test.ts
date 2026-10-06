import { describe, it, expect } from 'vitest';
import rehypeSanitize from 'rehype-sanitize';
import astroConfig from '../../astro.config.mjs';

/**
 * Guards the #200 render-side XSS mitigation: statute Markdown (derived from
 * external OLRC XML) must be sanitized at render so embedded raw HTML
 * (<img onerror>, <script>) and non-http(s) link protocols (javascript:) cannot
 * become live. The realistic regression is the sanitizer being dropped from the
 * Astro config, so assert it stays wired. (rehype-sanitize's own stripping
 * behaviour is verified upstream and via the build-smoke documented in the PR.)
 */
describe('markdown sanitization wiring', () => {
  it('astro config registers rehype-sanitize as a markdown rehype plugin', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unifiedOptions = (astroConfig.markdown as any)?.unified?.options;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugins = unifiedOptions?.rehypePlugins ?? (astroConfig.markdown as any)?.rehypePlugins ?? [];
    expect(plugins).toContain(rehypeSanitize);
  });

  it('unified markdown renderer strips malicious script tags from output', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unifiedProcessor = (astroConfig.markdown as any)?.unified;
    expect(unifiedProcessor).toBeDefined();
    const renderer = await unifiedProcessor.createRenderer({});
    const result = await renderer.render('# Section Title\n\n<script>alert("xss")</script>\n\nLegitimate statutory text.');
    expect(result.code).not.toContain('<script>');
    expect(result.code).toContain('Legitimate statutory text.');
  });
});

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
    const plugins = astroConfig.markdown?.rehypePlugins ?? [];
    expect(plugins).toContain(rehypeSanitize);
  });
});

import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import rehypeSanitize from 'rehype-sanitize';

export default defineConfig({
  integrations: [svelte()],
  vite: { plugins: [tailwindcss()] },
  site: 'https://civic-source.github.io',
  base: '/us-code-tracker/',
  // Sanitize the rendered statute Markdown (#200). Statute content derives
  // from external OLRC XML; the default (GitHub) schema strips raw HTML
  // (e.g. <img onerror>, <script>) and disallows non-http(s) link protocols
  // (e.g. [x](javascript:...)), closing the stored-XSS surface at render time.
  markdown: {
    rehypePlugins: [rehypeSanitize],
  },
});

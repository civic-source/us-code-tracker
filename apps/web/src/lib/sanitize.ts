import sanitizeHtml from 'sanitize-html';

/**
 * Strip all HTML tags to plain text.
 * Uses sanitize-html (a real HTML parser), not regex, so encoded entities and
 * malformed/nested tags can't bypass it. For displaying untrusted content as text.
 */
export function sanitizeContent(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  });
}

/**
 * Sanitize Pagefind excerpt HTML, preserving only <mark> highlight tags.
 * Used in client-side search results rendered via {@html ...}.
 */
export function sanitizeExcerpt(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['mark'],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  });
}

export interface CitationJump {
  title: string;
  section: string;
  display: string;
  pinpoint?: string[];
}

/**
 * Parses informal or formal U.S. Code legal citations into title and section.
 * Handles:
 * - "18 usc 111", "18 U.S.C. § 111", "18 U.S.C. 111"
 * - "title 18 section 111", "Title 18 § 111"
 * - "18 § 111", "18:111", "18-111"
 * - "42 usc 1983", "26 usc 501", "5 usc 552"
 */
export function parseCitation(input: string): CitationJump | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Pattern 1: Title prefix or plain number, optional U.S.C./§, section
  const pattern = /^(?:title\s+)?(\d+[a-z]?)\s*(?:u\.?s\.?c\.?a?|title|:|§)?\s*(?:sec(?:tion)?\.?|§|:|-)?\s*(\d+[a-z]*(?:-\d+[a-z]*)*)((?:\([a-zA-Z0-9]+\)){0,5})$/i;
  const match = trimmed.match(pattern);

  if (!match) return null;

  const title = match[1]?.toLowerCase();
  const section = match[2]?.toLowerCase();

  if (!title || !section) return null;

  const pinpoint = [...(match[3] ?? '').matchAll(/\(([a-zA-Z0-9]+)\)/g)].map(part => part[1]!);
  return {
    title,
    section,
    display: `${title.toUpperCase()} U.S.C. § ${section}${match[3] ?? ''}`,
    ...(pinpoint.length ? { pinpoint } : {}),
  };
}

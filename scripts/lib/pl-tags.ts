/**
 * Parsing and validation for OLRC public-law release tags (`pl-<congress>-<law>`)
 * including exclusion-bearing releases (`pl-119-73not60`) and revision suffixes (`pl-119-73-rev2`)
 * per USCT-006.
 *
 * Tag names are read from `git tag` on an operator-supplied `--repo`, then used
 * to build `git diff` ranges. Git ref names legally permit shell metacharacters
 * (`$`, backtick, `;`, `(`, `)`, `&`, `|`, …), so a tag such as `pl-1-1$(...)`
 * is a perfectly valid ref. Anchoring the pattern here guarantees that only
 * strictly well-formed alphanumeric/exclusion tags ever reach the rest of the pipeline.
 */
const PL_TAG_RE = /^pl-(\d+)-(\d+)(not\d+(?:and\d+)*)?(?:-rev(\d+))?$/;

export interface ParsedPlTag {
  congress: number;
  law: number;
  exclusionSuffix: string;
  revision: number;
  rawLawSegment: string;
}

/** True iff `name` is a strictly well-formed `pl-<congress>-<law>[not<N>][-rev<R>]` tag. */
export function isPlTag(name: string): boolean {
  return PL_TAG_RE.test(name);
}

/**
 * Parse a `pl-<congress>-<law>` tag into `[congress, law]`. Returns `[0, 0]`
 * for any name that is not strictly well-formed (including a `pl-`-prefixed
 * name that carries arbitrary trailing characters or shell metacharacters).
 */
export function parsePlTag(name: string): [number, number] {
  const m = PL_TAG_RE.exec(name);
  return m && m[1] && m[2] ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [0, 0];
}

/**
 * Parse full lossless identity components from a `pl-*` tag (USCT-006).
 */
export function parsePlTagFull(name: string): ParsedPlTag | null {
  const m = PL_TAG_RE.exec(name);
  if (!m?.[1] || !m[2]) return null;
  const congress = parseInt(m[1], 10);
  const law = parseInt(m[2], 10);
  const exclusionSuffix = m[3] ?? '';
  const revision = m[4] ? parseInt(m[4], 10) : 1;
  return {
    congress,
    law,
    exclusionSuffix,
    revision,
    rawLawSegment: `${law}${exclusionSuffix}`,
  };
}

/**
 * Filter a raw `git tag` listing down to well-formed pl tags and sort them by
 * `(congress, law, exclusion before complete, revision)`.
 */
export function sortPlTags(rawTags: string[]): string[] {
  return rawTags.filter(isPlTag).sort((a, b) => {
    const pa = parsePlTagFull(a);
    const pb = parsePlTagFull(b);
    if (!pa || !pb) return 0;
    if (pa.congress !== pb.congress) return pa.congress - pb.congress;
    if (pa.law !== pb.law) return pa.law - pb.law;
    // An exclusion release (e.g. 73not60) precedes the full release (73)
    if (pa.exclusionSuffix !== pb.exclusionSuffix) {
      if (pa.exclusionSuffix && !pb.exclusionSuffix) return -1;
      if (!pa.exclusionSuffix && pb.exclusionSuffix) return 1;
      return pa.exclusionSuffix.localeCompare(pb.exclusionSuffix);
    }
    return pa.revision - pb.revision;
  });
}

/**
 * Parsing and validation for OLRC public-law release tags (`pl-<congress>-<law>`).
 *
 * Tag names are read from `git tag` on an operator-supplied `--repo`, then used
 * to build `git diff` ranges. Git ref names legally permit shell metacharacters
 * (`$`, backtick, `;`, `(`, `)`, `&`, `|`, …), so a tag such as `pl-1-1$(...)`
 * is a perfectly valid ref. Anchoring the pattern here guarantees that only
 * strictly well-formed numeric tags ever reach the rest of the pipeline —
 * defense in depth alongside the shell-free `execFileSync` git invocations that
 * actually closed the injection vector (#235).
 */
const PL_TAG_RE = /^pl-(\d+)-(\d+)$/;

/** True iff `name` is a strictly well-formed `pl-<congress>-<law>` tag. */
export function isPlTag(name: string): boolean {
  return PL_TAG_RE.test(name);
}

/**
 * Parse a `pl-<congress>-<law>` tag into `[congress, law]`. Returns `[0, 0]`
 * for any name that is not strictly well-formed (including a `pl-`-prefixed
 * name that carries trailing characters or shell metacharacters).
 */
export function parsePlTag(name: string): [number, number] {
  const m = PL_TAG_RE.exec(name);
  return m && m[1] && m[2] ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [0, 0];
}

/**
 * Filter a raw `git tag` listing down to well-formed pl tags and sort them by
 * `(congress, law)`. Any entry that is not strictly `pl-<digits>-<digits>` is
 * dropped, so malformed or hostile tags never flow into a diff range.
 */
export function sortPlTags(rawTags: string[]): string[] {
  return rawTags.filter(isPlTag).sort((a, b) => {
    const [ac, al] = parsePlTag(a);
    const [bc, bl] = parsePlTag(b);
    return ac !== bc ? ac - bc : al - bl;
  });
}

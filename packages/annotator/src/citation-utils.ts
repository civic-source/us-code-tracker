import type { PrecedentAnnotation } from '@civic-source/types';

/** A single case from the PrecedentAnnotation.cases array */
type CaseAnnotation = PrecedentAnnotation['cases'][number];

/** Normalize a legal citation for deduplication */
export function normalizeCitation(citation: string): string {
  return citation
    .replace(/\s+/g, ' ')
    .replace(/§\s*/g, 'Section ')
    .replace(/\bU\.S\.C\./g, 'USC')
    .trim()
    .toLowerCase();
}

/**
 * Build a deduplication key for a case.
 *
 * Cases with a non-empty citation are keyed on the normalized citation so that
 * genuine duplicate citations collapse. Cases with an empty citation (common
 * for CourtListener results that lack a structured citation) fall back to a
 * composite key of caseName + date + sourceUrl so that distinct uncited cases
 * are NOT mistakenly collapsed into a single entry.
 */
function dedupeKey(c: CaseAnnotation): string {
  const normalized = normalizeCitation(c.citation);
  if (normalized !== '') return `cite:${normalized}`;
  return `composite:${c.caseName}|${c.date}|${c.sourceUrl}`;
}

/** Deduplicate cases by normalized citation, preserving first occurrence */
export function deduplicateCases(cases: CaseAnnotation[]): CaseAnnotation[] {
  const seen = new Set<string>();
  return cases.filter((c) => {
    const key = dedupeKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

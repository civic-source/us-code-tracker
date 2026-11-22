# USCT-007: Preserve complete release catalogs and paginate API fallbacks

**Status:** proposed  
**Readiness:** blocked  
**Type:** delivery  
**Milestone:** M0 — Reconcile existing work and repair current trust/history failures

## What it delivers

A reader and importer can find every cataloged release and detect incomplete API fallback history rather than silently accepting the first response page.

## Blocked by

- [USCT-001](USCT-001.md)

## Acceptance criteria

- [ ] A proposed synthetic fixture of 103 distinct release identities retains all 103 in the complete catalog, history navigation and import selection; this fixture is not a claim about live corpus totals.
- [ ] The current static manifest path remains the primary historical source. The GitHub tag fallback must paginate beyond its observed per_page=100 request, and file-history fallback must paginate beyond its observed per_page=50 request or explicitly declare a bounded/incomplete scope.
- [ ] Pagination ends only on verified exhaustion; duplicate pages, a failed later page or a resource cap produce explicit completeness results rather than silent truncation.
- [ ] The eight-item commit preview stays a presentation choice; it must not define the underlying catalog/history completeness.

## Independent validation

Create an independently enumerated synthetic 103-release fixture and a 53-commit history fixture. Check exact identity sets, navigation beyond the first pages, duplicate-page behavior and failure of the final page.

## Demo

Navigate to synthetic release 101 and commit 51, then inspect the incomplete state when the next API page fails.

## Evidence needed to close

- Synthetic fixture provenance and expected identity sets
- Static-manifest path compatibility
- Paginated fallback results
- Failed-page completeness result

## Rollback notes

Restore the preceding validated catalog artifact or disable the fallback with an explicit unavailable state; do not silently treat a first page as complete.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Observed at the pinned tracker snapshot: DiffViewer reads static manifest pairs first; its fallback fetches tags with per_page=100 without a pagination loop. getFileHistory requests commits with per_page=50. No 60-release cap was verified. Counts 103 and 53 are proposed synthetic regression cases, not observed production counts.

## Observed source references

- [DiffViewer static manifest, tag fallback and commit preview](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/apps/web/src/components/DiffViewer.svelte)
- [getFileHistory one-page commit request](https://github.com/civic-source/us-code-tracker/blob/822d2a5f904a874f107bcdf4c99f0e1fda4f5d51/apps/web/src/lib/github.ts)

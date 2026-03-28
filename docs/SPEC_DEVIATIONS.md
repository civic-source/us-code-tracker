# Spec Deviations

Documented deviations from the original project specification, with rationale.

## 1. XML Parser: fast-xml-parser instead of Cheerio

**Spec:** Cheerio for HTML/XML parsing.

**Actual:** `fast-xml-parser` v5.

**Rationale:**
- USLM XML uses namespaces extensively. fast-xml-parser provides namespace-aware parsing with `preserveOrder` mode, which retains element ordering critical for statute text fidelity. Cheerio treats XML as tag soup and loses namespace semantics.
- fast-xml-parser disables entity expansion by default, mitigating XXE (XML External Entity) attacks. Cheerio's underlying htmlparser2 does not handle XXE prevention natively.
- Confirmed via consensus vote prior to implementation.

## 2. Tailwind CSS: v4 instead of v3.4+

**Spec:** Tailwind CSS v3.4+.

**Actual:** Tailwind CSS v4.2 with `@tailwindcss/vite` plugin.

**Rationale:**
- Greenfield project with no existing Tailwind v3 configuration to migrate.
- Tailwind v3 entered maintenance mode. v4 is the actively developed version.
- v4's Vite-native plugin (`@tailwindcss/vite`) replaces the PostCSS-based workflow, simplifying the build chain.

## 3. Project Name: civic-source/us-code-tracker instead of openlaw-git

**Spec:** Project name `openlaw-git`.

**Actual:** npm scope `@civic-source/*`, with the repo name `openlaw-git-pipeline` and the eventual public-facing name `us-code-tracker`.

**Rationale:**
- `openlaw-git` conflicted with existing projects in the open-law space.
- `civic-source` better describes the project's scope (civic data, not just law).
- Confirmed via naming consensus vote.

## 4. CourtListener Coverage: Approximate via Full-Text Search

**Spec:** Structured citation index for case-to-statute mappings.

**Actual:** Full-text search using CourtListener's search API (e.g., querying `"18 U.S.C. 111"`).

**Rationale:**
- CourtListener does not expose a structured citation-to-statute index. No such API endpoint exists.
- Full-text search is the best available approximation. It finds cases that mention a statute citation in their text, but may miss cases that cite the statute using non-standard formats.
- This limitation is documented in the `Annotator` class and reflected in the schema field name (`holdingSummary` from search snippets, not from a structured holdings database).

## 5. @astrojs/tailwind Deprecated: Using @tailwindcss/vite Directly

**Spec:** `@astrojs/tailwind` integration.

**Actual:** `@tailwindcss/vite` plugin configured directly in the Astro Vite config.

**Rationale:**
- `@astrojs/tailwind` was deprecated by the Astro team in favor of using the Tailwind Vite plugin directly.
- The Tailwind v4 migration guide recommends `@tailwindcss/vite` as the standard integration path.
- Fewer moving parts: one plugin instead of a wrapper around a plugin.

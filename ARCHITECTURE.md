# Architecture

## System Overview

The pipeline fetches US Code statute XML from the Office of the Law Revision Counsel (OLRC), transforms it to Markdown, annotates sections with case law from CourtListener, and publishes the result as a static Astro site.

```
OLRC Website (uscode.house.gov)
        |
        v
  +-----------+     +---------------+     +------------+
  |  Fetcher  | --> | Transformer   | --> | Annotator  |
  | (ZIP/XML) |     | (XML -> MD)   |     | (cases)    |
  +-----------+     +---------------+     +------------+
        |                   |                    |
        +-------------------+--------------------+
                            |
                            v
                     +-----------+
                     | Pipeline  |  (orchestration)
                     +-----------+
                            |
                            v
                   us-code repo (data)
                            |
                            v
                     +-----------+
                     |    Web    |  (Astro static site)
                     +-----------+
```

## Package Responsibilities

| Package | Scope | Purpose |
|---------|-------|---------|
| `@civic-source/types` | `packages/types` | Shared Zod schemas and TypeScript interfaces. Defines `ReleasePoint`, `PrecedentAnnotation`, `Result<T,E>`, `IUsCodeFetcher`, `IXmlToMarkdownAdapter`. |
| `@civic-source/fetcher` | `packages/fetcher` | Downloads release point listings and ZIP archives from the OLRC. Includes SHA-256 hash-based caching (`HashStore`) to skip unchanged content, exponential backoff retry, and a structured logger. |
| `@civic-source/transformer` | `packages/transformer` | Parses USLM XML using `fast-xml-parser` in `preserveOrder` mode and generates per-section Markdown files with YAML frontmatter. Handles namespace-aware element traversal. |
| `@civic-source/annotator` | `packages/annotator` | Queries CourtListener's full-text search API to find cases citing a given statute section. Maps results to the `PrecedentAnnotation` schema. Rate-limited. |
| `@civic-source/pipeline` | `packages/pipeline` | Orchestrates the end-to-end flow: fetch release points, transform each title's XML to Markdown, write files, and optionally annotate with case law. Per-title failures do not block other titles. |
| `@civic-source/web` | `apps/web` | Astro v5 static site that renders statute Markdown with Tailwind CSS styling, Pagefind search, and Svelte interactive components. |

## Dual-Repo Strategy

Two repositories serve distinct purposes:

- **us-code-tracker** (this repo) -- Source code for the pipeline, transformer, annotator, and web application. Contains no statute data.
- **us-code** (data repo) -- Git repository of transformed statute Markdown files. The pipeline writes output here. Git history provides a structured diff of how the US Code changes over time, keyed by public law.

Separation keeps the code repository small and the data repository optimized for content diffing without build artifacts.

## Sidecar Pattern for Precedent Annotations

Annotations are stored as JSON sidecar files alongside the statute Markdown they reference:

```
statutes/
  title-18/
    chapter-7/
      section-111.md                    # Statute text
      section-111.annotations.json      # Precedent cases (sidecar)
```

This pattern was chosen because:

- Statute text and annotations have different update cadences. Statutes change when Congress passes laws. Annotations change when new cases are decided or CourtListener indexes them.
- Git diffs remain readable. Statute text changes are not interleaved with annotation data changes.
- The web layer can load annotations lazily or skip them entirely without affecting statute rendering.

## Data Flow

```
1. OLRC publishes release points at uscode.house.gov/download/
2. Fetcher scrapes the download page for ZIP links (regex on href)
3. Fetcher downloads ZIP, computes SHA-256, checks HashStore
4. If hash unchanged -> skip (returns empty string)
5. If hash changed -> Transformer parses USLM XML
6. Parser extracts title/chapter/section hierarchy via preserveOrder traversal
7. Markdown generator produces one .md file per section with frontmatter
8. Pipeline writes files to output directory (us-code repo)
9. Annotator queries CourtListener for each section citation
10. Annotation JSON written as sidecar files
11. Astro site builds from the output directory
```

## Technology Choices

| Choice | Alternative Considered | Rationale |
|--------|----------------------|-----------|
| **fast-xml-parser** | Cheerio | Namespace-aware parsing required for USLM XML. Built-in XXE prevention. See `docs/SPEC_DEVIATIONS.md`. |
| **Zod** | io-ts, manual validation | Runtime schema validation with TypeScript type inference. Single schema definition serves both validation and type generation. |
| **Astro v5** | Next.js, plain HTML | Static-first with zero JS by default. Content-heavy site does not need a SPA framework. Svelte islands for interactive components. |
| **Tailwind CSS v4** | v3, plain CSS | Greenfield project; v4 is actively developed while v3 is in maintenance. Vite-native plugin simplifies build. |
| **Turborepo** | Nx, Lerna | Lightweight build orchestration for pnpm workspaces. Task caching and topological dependency ordering out of the box. |
| **Result\<T,E\>** | Exceptions | Explicit error handling via discriminated unions. Callers must handle both success and failure paths. No uncaught exception surprises. |
| **SHA-256 hash caching** | ETag/If-Modified-Since | OLRC does not serve consistent cache headers. Local hash comparison is reliable and works offline for reruns. |
| **CourtListener search API** | Structured citation index | No structured statute citation API exists. Full-text search is the best available approach. See `docs/SPEC_DEVIATIONS.md`. |

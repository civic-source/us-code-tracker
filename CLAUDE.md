# OpenLaw-Git Pipeline - Claude Code Instructions

## Tech Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Language:** TypeScript 5.8+ (strict mode, NodeNext)
- **Validation:** Zod v3
- **Testing:** Vitest
- **Web:** Astro v5
- **CI:** GitHub Actions (ubuntu-latest, Node 22)

## Quick Commands

```bash
pnpm install        # Install all dependencies
pnpm build          # Build all packages (topological order)
pnpm test           # Run all tests
pnpm lint           # Lint all packages
pnpm typecheck      # Type-check all packages

# Historical import
npx tsx scripts/import-history.ts --repo /path/to/us-code                          # Full import
npx tsx scripts/import-history.ts --repo /path/to/us-code --start pl/119/1 --end pl/119/73  # Range
npx tsx scripts/import-history.ts --repo /path/to/us-code --title 18 --dry-run     # Single title dry run
npx tsx scripts/import-history.ts --repo /path/to/us-code --resume                 # Resume interrupted
```

## Core Principles

```
correctness > simplicity > performance
```

- **TDD** -- Write failing test first, then minimum code to pass, then refactor.
- **YAGNI** -- Only implement what is needed now. No speculative abstractions.
- **DRY** -- Extract shared logic at 3+ occurrences, not before.

## Zero `any` Policy

`any` is banned. Use `unknown` and narrow with type guards or Zod.

## Canonical Paths

| Concern         | Package                   | Entry Point     |
| --------------- | ------------------------- | --------------- |
| Shared types    | `@civic-source/types`      | `src/index.ts`  |
| OLRC fetcher    | `@civic-source/fetcher`    | `src/index.ts`  |
| XML transformer | `@civic-source/transformer`| `src/index.ts`  |
| Web app         | `@civic-source/web`        | `src/pages/`    |

## Self-Hosted Runner Policy

Cron and workflow_dispatch jobs may use self-hosted runners. Push/PR CI runs on ubuntu-latest only.

## Commit Messages

Use conventional commits: `type(scope): description`

Types: feat, fix, refactor, docs, test, chore, perf

Enforced by commitlint in CI (on PRs) via `commitlint.config.ts`.

## Releases

**Semver policy:** 0.x = pre-release (breaking changes allowed in minor bumps). 1.0 = first stable release.

**Cutting a release:**

```bash
# 1. Bump version + regenerate changelog
pnpm version:patch   # or version:minor / version:major

# 2. Commit, tag, and push
pnpm release
```

This creates a git tag (`v0.1.0`, etc.) which triggers the `release.yml` workflow to build, test, and publish a GitHub Release with auto-generated changelog notes.

**Changelog:** Generated from conventional commits via `conventional-changelog`. The full history lives in `CHANGELOG.md`.

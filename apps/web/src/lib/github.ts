import { Octokit } from "@octokit/rest";
import { sanitizeContent, sanitizeExcerpt } from "./sanitize.js";

export interface CommitInfo {
  sha: string;
  message: string;
  date: string;
  author: string;
}

export interface ReleaseTag {
  name: string;
  date: string;
  commitSha?: string;
}

export interface DiffLine {
  type: "add" | "del" | "context";
  content: string;
}

export interface FileDiffOptions {
  owner: string;
  repo: string;
  base: string;
  head: string;
  path: string;
  token?: string;
}

export type CatalogCompletenessState = "complete" | "partial" | "failed";

export interface PaginatedCatalogResult<T> {
  items: T[];
  completeness: CatalogCompletenessState;
  pagesFetched: number;
  duplicateItemsDropped: number;
  cappedByMaxPages: boolean;
  errorMessage?: string;
}

function createClient(token?: string): Octokit {
  return new Octokit(token ? { auth: token } : {});
}

const PL_TAG_PARSE_RE = /^pl-(\d+)-(\d+)(not\d+(?:and\d+)*)?(?:-rev(\d+))?$/;

export function parseReleaseTagParts(name: string): {
  valid: boolean;
  congress: number;
  law: number;
  exclusionSuffix: string;
  revision: number;
} {
  const m = PL_TAG_PARSE_RE.exec(name);
  if (!m?.[1] || !m[2]) {
    return { valid: false, congress: 0, law: 0, exclusionSuffix: "", revision: 0 };
  }
  return {
    valid: true,
    congress: parseInt(m[1], 10),
    law: parseInt(m[2], 10),
    exclusionSuffix: m[3] ?? "",
    revision: m[4] ? parseInt(m[4], 10) : 1,
  };
}

export function sortReleaseTags(tags: ReleaseTag[]): ReleaseTag[] {
  return [...tags].sort((a, b) => {
    const pa = parseReleaseTagParts(a.name);
    const pb = parseReleaseTagParts(b.name);
    if (pa.congress !== pb.congress) return pa.congress - pb.congress;
    if (pa.law !== pb.law) return pa.law - pb.law;
    if (pa.exclusionSuffix !== pb.exclusionSuffix) {
      if (pa.exclusionSuffix && !pb.exclusionSuffix) return -1;
      if (!pa.exclusionSuffix && pb.exclusionSuffix) return 1;
      return pa.exclusionSuffix.localeCompare(pb.exclusionSuffix);
    }
    return pa.revision - pb.revision;
  });
}

/**
 * Paginate GitHub release tags beyond a single `per_page=100` request (USCT-007).
 * - Terminates only on verified exhaustion (`pageData.length < perPage`) or an explicit `maxPages` cap.
 * - Detects duplicate pages / duplicate tag names and failed later pages, returning explicit
 *   `completeness: 'complete' | 'partial' | 'failed'` metadata rather than silently truncating.
 */
export async function getPaginatedReleaseTags(
  owner: string,
  repo: string,
  options?: {
    token?: string | undefined;
    perPage?: number | undefined;
    maxPages?: number | undefined;
    fetchFn?: typeof fetch | undefined;
  }
): Promise<PaginatedCatalogResult<ReleaseTag>> {
  const perPage = options?.perPage ?? 100;
  const maxPages = options?.maxPages ?? 25;
  const fetchFn = options?.fetchFn ?? fetch;

  const seenNames = new Set<string>();
  const collected: ReleaseTag[] = [];
  let pagesFetched = 0;
  let duplicateItemsDropped = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://api.github.com/repos/${owner}/${repo}/tags?per_page=${perPage}&page=${page}`;
    try {
      const response = await fetchFn(url, {
        headers: options?.token ? { Authorization: `token ${options.token}` } : {},
      });

      if (!response.ok) {
        const completeness: CatalogCompletenessState =
          collected.length > 0 ? "partial" : "failed";
        return {
          items: sortReleaseTags(collected),
          completeness,
          pagesFetched,
          duplicateItemsDropped,
          cappedByMaxPages: false,
          errorMessage: `GitHub tags API failed on page ${page} with HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as unknown;
      if (!Array.isArray(data)) {
        const completeness: CatalogCompletenessState =
          collected.length > 0 ? "partial" : "failed";
        return {
          items: sortReleaseTags(collected),
          completeness,
          pagesFetched,
          duplicateItemsDropped,
          cappedByMaxPages: false,
          errorMessage: `Malformed GitHub tags response on page ${page}`,
        };
      }

      pagesFetched++;
      if (data.length === 0) {
        return {
          items: sortReleaseTags(collected),
          completeness: "complete",
          pagesFetched,
          duplicateItemsDropped,
          cappedByMaxPages: false,
        };
      }

      let newItemsOnPage = 0;
      for (const rawItem of data) {
        if (typeof rawItem !== "object" || rawItem === null || !("name" in rawItem)) continue;
        const name = String((rawItem as { name: unknown }).name);
        if (!parseReleaseTagParts(name).valid) continue;
        if (seenNames.has(name)) {
          duplicateItemsDropped++;
          continue;
        }
        seenNames.add(name);
        newItemsOnPage++;
        const commitObj = (rawItem as { commit?: { sha?: string } }).commit;
        collected.push({
          name,
          date: "",
          ...(commitObj?.sha ? { commitSha: commitObj.sha } : {}),
        });
      }

      // If an API mock or server repeats an identical page endlessly, stop and report partial/complete
      if (newItemsOnPage === 0 && data.length > 0) {
        return {
          items: sortReleaseTags(collected),
          completeness: "partial",
          pagesFetched,
          duplicateItemsDropped,
          cappedByMaxPages: false,
          errorMessage: `Duplicate tag page detected on page ${page}; stopped pagination`,
        };
      }

      // Verified exhaustion: fewer items than requested page size
      if (data.length < perPage) {
        return {
          items: sortReleaseTags(collected),
          completeness: "complete",
          pagesFetched,
          duplicateItemsDropped,
          cappedByMaxPages: false,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const completeness: CatalogCompletenessState =
        collected.length > 0 ? "partial" : "failed";
      return {
        items: sortReleaseTags(collected),
        completeness,
        pagesFetched,
        duplicateItemsDropped,
        cappedByMaxPages: false,
        errorMessage: `Network error on page ${page}: ${msg}`,
      };
    }
  }

  // Reached maxPages cap while pages were still full
  return {
    items: sortReleaseTags(collected),
    completeness: "partial",
    pagesFetched,
    duplicateItemsDropped,
    cappedByMaxPages: true,
    errorMessage: `Reached maximum pagination cap (${maxPages} pages of ${perPage}) before verified exhaustion`,
  };
}

/**
 * Paginate file commit history beyond a single `per_page=50` request (USCT-007).
 * - Uses either an injected page fetcher or Octokit `repos.listCommits` across pages.
 * - Reports explicit `completeness` (`complete`, `partial`, `failed`) when a later page fails
 *   or when `maxPages` bounds the history.
 */
export async function getPaginatedFileHistory(
  owner: string,
  repo: string,
  path: string,
  options?: {
    token?: string | undefined;
    perPage?: number | undefined;
    maxPages?: number | undefined;
    listCommitsPage?: ((page: number, perPage: number) => Promise<Array<{
      sha: string;
      commit: { message: string; author?: { date?: string; name?: string } | null };
    }>>) | undefined;
  }
): Promise<PaginatedCatalogResult<CommitInfo>> {
  const perPage = options?.perPage ?? 50;
  const maxPages = options?.maxPages ?? 20;
  const octokit = options?.listCommitsPage ? null : createClient(options?.token);

  const seenShas = new Set<string>();
  const collected: CommitInfo[] = [];
  let pagesFetched = 0;
  let duplicateItemsDropped = 0;

  for (let page = 1; page <= maxPages; page++) {
    try {
      const rawCommits = options?.listCommitsPage
        ? await options.listCommitsPage(page, perPage)
        : (
            await octokit!.repos.listCommits({
              owner,
              repo,
              path,
              per_page: perPage,
              page,
            })
          ).data;

      pagesFetched++;
      if (rawCommits.length === 0) {
        return {
          items: collected,
          completeness: "complete",
          pagesFetched,
          duplicateItemsDropped,
          cappedByMaxPages: false,
        };
      }

      let newItemsOnPage = 0;
      for (const c of rawCommits) {
        if (seenShas.has(c.sha)) {
          duplicateItemsDropped++;
          continue;
        }
        seenShas.add(c.sha);
        newItemsOnPage++;
        collected.push({
          sha: c.sha,
          message: c.commit.message.split("\n")[0] ?? "",
          date: c.commit.author?.date ?? "",
          author: c.commit.author?.name ?? "unknown",
        });
      }

      if (newItemsOnPage === 0 && rawCommits.length > 0) {
        return {
          items: collected,
          completeness: "partial",
          pagesFetched,
          duplicateItemsDropped,
          cappedByMaxPages: false,
          errorMessage: `Duplicate commit page detected on page ${page}; stopped pagination`,
        };
      }

      if (rawCommits.length < perPage) {
        return {
          items: collected,
          completeness: "complete",
          pagesFetched,
          duplicateItemsDropped,
          cappedByMaxPages: false,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const completeness: CatalogCompletenessState =
        collected.length > 0 ? "partial" : "failed";
      return {
        items: collected,
        completeness,
        pagesFetched,
        duplicateItemsDropped,
        cappedByMaxPages: false,
        errorMessage: `Commit history failed on page ${page}: ${msg}`,
      };
    }
  }

  return {
    items: collected,
    completeness: "partial",
    pagesFetched,
    duplicateItemsDropped,
    cappedByMaxPages: true,
    errorMessage: `Reached maximum commit pagination cap (${maxPages} pages of ${perPage})`,
  };
}

/**
 * Legacy wrapper returning CommitInfo[] while delegating to `getPaginatedFileHistory`.
 * Throws if the initial request fails with zero commits so existing error handlers catch it.
 */
export async function getFileHistory(
  owner: string,
  repo: string,
  path: string,
  token?: string,
): Promise<CommitInfo[]> {
  const result = await getPaginatedFileHistory(owner, repo, path, { token });
  if (result.completeness === "failed") {
    throw new Error(result.errorMessage ?? "Failed to load commit history");
  }
  return result.items;
}

export async function getFileDiff(
  options: FileDiffOptions,
): Promise<DiffLine[] | null> {
  try {
    const octokit = createClient(options.token);
    const response = await octokit.repos.compareCommits({
      owner: options.owner,
      repo: options.repo,
      base: options.base,
      head: options.head,
      mediaType: { format: "diff" },
    });

    const files = response.data.files ?? [];
    const file = files.find((f) => f.filename === options.path);
    if (!file?.patch) return [];

    return file.patch.split("\n").flatMap((line): DiffLine[] => {
      if (line.startsWith("@@")) return [];
      if (line.startsWith("+") && !line.startsWith("+++")) {
        return [{ type: "add", content: line.slice(1) }];
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        return [{ type: "del", content: line.slice(1) }];
      }
      const content = line.startsWith(" ") ? line.slice(1) : line;
      return [{ type: "context", content }];
    });
  } catch {
    return null;
  }
}

export async function getFileAtRef(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token?: string,
): Promise<string | null> {
  try {
    const octokit = createClient(token);
    const response = await octokit.repos.getContent({ owner, repo, path, ref });
    const data = response.data;
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
      return null;
    }
    const decoded = atob(data.content);
    return sanitizeContent(decoded);
  } catch {
    return null;
  }
}

export { sanitizeContent, sanitizeExcerpt };

/** Format a pl-* tag name into a human-readable label */
export function formatTagName(tag: string): string {
  return tag.replace(/^pl-/, "PL ");
}

/** Extract year from a tag name (congress number) or fall back to ISO date string */
export function extractYear(date: string, tagName?: string): string {
  if (tagName) {
    const match = tagName.match(/pl-(\d+)-/);
    if (match && match[1]) {
      const congress = parseInt(match[1], 10);
      const startYear = 2013 + (congress - 113) * 2;
      return `${startYear}`;
    }
  }
  if (!date) return "";
  return new Date(date).getFullYear().toString();
}

export function isRateLimited(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  const status = (error as { status: number }).status;
  return status === 403 || status === 429;
}

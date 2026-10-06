import { Octokit } from "@octokit/rest";
import { sanitizeContent, sanitizeExcerpt } from "./sanitize.js";

export interface CommitInfo {
  sha: string;
  message: string;
  date: string;
  author: string;
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

function createClient(token?: string): Octokit {
  return new Octokit(token ? { auth: token } : {});
}

export async function getFileHistory(
  owner: string,
  repo: string,
  path: string,
  token?: string,
): Promise<CommitInfo[]> {
  const octokit = createClient(token);
  const response = await octokit.repos.listCommits({ owner, repo, path, per_page: 50 });

  return response.data.map((c) => ({
    sha: c.sha,
    message: c.commit.message.split("\n")[0] ?? "",
    date: c.commit.author?.date ?? "",
    author: c.commit.author?.name ?? "unknown",
  }));
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
  // "pl-113-100" → "PL 113-100"
  return tag.replace(/^pl-/, "PL ");
}

/** Extract year from a tag name (congress number) or fall back to ISO date string */
export function extractYear(date: string, tagName?: string): string {
  // Derive from congress number in tag name: pl-113-* → 2013-2014
  if (tagName) {
    const match = tagName.match(/pl-(\d+)-/);
    if (match && match[1]) {
      const congress = parseInt(match[1], 10);
      // Congress starts in odd year: 113th = 2013-2014, 114th = 2015-2016, etc.
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
  // GitHub returns 403 for unauthenticated rate limits and 429 for secondary rate limits
  return status === 403 || status === 429;
}

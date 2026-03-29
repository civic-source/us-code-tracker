import { Octokit } from "@octokit/rest";

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

    return file.patch.split("\n").map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        return { type: "add", content: line };
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        return { type: "del", content: line };
      }
      return { type: "context", content: line };
    });
  } catch {
    return null;
  }
}

export interface ReleaseTag {
  name: string;
  date: string;
}

export async function getReleaseTags(
  owner: string,
  repo: string,
  token?: string,
): Promise<ReleaseTag[]> {
  const octokit = createClient(token);
  const response = await octokit.repos.listTags({ owner, repo, per_page: 100 });
  const plTags = response.data.filter((t) => t.name.startsWith("pl-"));

  const results: ReleaseTag[] = [];
  for (const tag of plTags) {
    try {
      const commit = await octokit.repos.getCommit({ owner, repo, ref: tag.commit.sha });
      results.push({
        name: tag.name,
        date: commit.data.commit.author?.date ?? "",
      });
    } catch {
      results.push({ name: tag.name, date: "" });
    }
  }

  return results.sort((a, b) => a.date.localeCompare(b.date));
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

/** Strip HTML tags from content to prevent XSS */
export function sanitizeContent(raw: string): string {
  return raw.replace(/<[^>]*>/g, "");
}

/** Format a pl-* tag name into a human-readable label */
export function formatTagName(tag: string): string {
  // "pl-113-100" → "PL 113-100"
  return tag.replace(/^pl-/, "PL ").replace(/-/g, "-");
}

/** Extract year from an ISO date string */
export function extractYear(date: string): string {
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

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
    message: c.commit.message.split("\n")[0],
    date: c.commit.author?.date ?? "",
    author: c.commit.author?.name ?? "unknown",
  }));
}

export async function getFileDiff(
  owner: string,
  repo: string,
  base: string,
  head: string,
  path: string,
  token?: string,
): Promise<DiffLine[]> {
  const octokit = createClient(token);
  const response = await octokit.repos.compareCommits({
    owner,
    repo,
    base,
    head,
    mediaType: { format: "diff" },
  });

  const files = response.data.files ?? [];
  const file = files.find((f) => f.filename === path);
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
}

export function isRateLimited(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: number }).status === 403
  );
}

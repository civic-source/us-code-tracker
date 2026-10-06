<script lang="ts">
  import {
    getFileHistory, getFileDiff, getFileAtRef,
    isRateLimited, formatTagName, extractYear,
    type CommitInfo, type DiffLine, type ReleaseTag,
  } from "../lib/github";

  interface SectionDiff {
    from: string;
    to: string;
    lines: { type: "add" | "del" | "context"; content: string }[];
  }

  interface DiffManifest {
    pairs: { from: string; to: string; changedSections: number }[];
    generatedAt: string;
  }

  interface CongressGroup {
    congress: number;
    label: string;
    years: string;
    tags: ReleaseTag[];
    changedCount: number;
  }

  interface WordToken {
    type: "context" | "add" | "del";
    text: string;
  }

  interface RedlineRow {
    type: "paired" | "del" | "add" | "context";
    tokens?: WordToken[];
    delContent?: string;
    addContent?: string;
    content?: string;
  }

  interface Props {
    sectionPath: string;
    repoOwner?: string;
    repoName?: string;
    githubToken?: string;
  }

  let {
    sectionPath,
    repoOwner = "civic-source",
    repoName = "us-code",
    githubToken,
  }: Props = $props();

  let commits = $state<CommitInfo[]>([]);
  let tags = $state<ReleaseTag[]>([]);
  let diffLines = $state<DiffLine[]>([]);
  let loading = $state(false);
  let diffLoading = $state(false);
  let tagLoading = $state(false);
  let error = $state("");
  let compareFrom = $state("");
  let compareTo = $state("");
  let selectedTagContent = $state("");
  let selectedTag = $state("");
  let hasCompared = $state(false);
  let usingStaticDiffs = $state(false);
  let manifest = $state<DiffManifest | null>(null);
  let expandedCongress = $state<Set<number>>(new Set());
  let onlyShowChanges = $state(true);
  let showAllHistory = $state(false);
  let diffMode = $state<"redline" | "split" | "raw">("redline");
  const HISTORY_PREVIEW_COUNT = 10;

  /** Simple word/punctuation tokenizer */
  function tokenizeWords(text: string): string[] {
    return text.match(/\w+|\s+|[^\w\s]/g) || [text];
  }

  /** Longest Common Subsequence word-level diff */
  function computeWordDiff(oldText: string, newText: string): WordToken[] {
    const a = tokenizeWords(oldText);
    const b = tokenizeWords(newText);
    const m = a.length;
    const n = b.length;

    // LCS table
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        if (a[i] === b[j]) {
          dp[i + 1]![j + 1] = dp[i]![j]! + 1;
        } else {
          dp[i + 1]![j + 1] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
        }
      }
    }

    // Backtrack to build tokens
    const tokens: WordToken[] = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        tokens.unshift({ type: "context", text: a[i - 1]! });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
        tokens.unshift({ type: "add", text: b[j - 1]! });
        j--;
      } else if (i > 0 && (j === 0 || dp[i]![j - 1]! < dp[i - 1]![j]!)) {
        tokens.unshift({ type: "del", text: a[i - 1]! });
        i--;
      }
    }
    return tokens;
  }

  /** Build redline rows by pairing consecutive del and add lines */
  let redlineRows = $derived.by<RedlineRow[]>(() => {
    const rows: RedlineRow[] = [];
    let i = 0;
    while (i < diffLines.length) {
      const current = diffLines[i]!;
      if (current.type === "del") {
        const next = diffLines[i + 1];
        if (next && next.type === "add") {
          // Pair deletion with addition for word-level redline
          const tokens = computeWordDiff(current.content, next.content);
          rows.push({
            type: "paired",
            tokens,
            delContent: current.content,
            addContent: next.content,
          });
          i += 2;
          continue;
        }
        rows.push({ type: "del", content: current.content });
        i++;
      } else if (current.type === "add") {
        rows.push({ type: "add", content: current.content });
        i++;
      } else {
        rows.push({ type: "context", content: current.content });
        i++;
      }
    }
    return rows;
  });

  /** Total word and line change counts */
  let diffMetrics = $derived.by(() => {
    let additions = 0;
    let deletions = 0;
    for (const line of diffLines) {
      if (line.type === "add") additions++;
      else if (line.type === "del") deletions++;
    }
    return { additions, deletions };
  });

  /** Parse congress number from a pl-* tag name */
  function parseCongress(tagName: string): number {
    const m = /pl-(\d+)-/.exec(tagName);
    return m ? parseInt(m[1], 10) : 0;
  }

  /** Get year range for a congress number */
  function congressYears(congress: number): string {
    const startYear = 2013 + (congress - 113) * 2;
    return `${startYear}\u2013${startYear + 1}`;
  }

  /** Get ordinal suffix for congress number */
  function ordinal(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /** Check if a tag changed this section (using diff manifest) */
  function tagChangedThisSection(tagName: string): boolean {
    if (!manifest) return true;
    const parts = sectionPathToParts(sectionPath);
    if (!parts) return true;
    return sectionChangePairs.has(tagName);
  }

  let sectionChangePairs = $state<Set<string>>(new Set());

  async function buildSectionChangePairs(): Promise<void> {
    if (!manifest) return;
    const parts = sectionPathToParts(sectionPath);
    if (!parts) return;
    const baseUrl = getBaseUrl();
    const changed = new Set<string>();
    if (tags.length > 0) {
      const first = tags[0];
      if (first) changed.add(first.name);
    }
    for (const pair of manifest.pairs) {
      try {
        const url = `${baseUrl}diffs/${pair.from}_${pair.to}/${parts.title}/${parts.section}.json`;
        const res = await fetch(url, { method: "HEAD" });
        if (res.ok) {
          changed.add(pair.to);
        }
      } catch {
        // Skip
      }
    }
    sectionChangePairs = changed;
  }

  function groupByCongress(allTags: ReleaseTag[]): CongressGroup[] {
    const groups = new Map<number, ReleaseTag[]>();
    for (const tag of allTags) {
      const congress = parseCongress(tag.name);
      if (!groups.has(congress)) groups.set(congress, []);
      groups.get(congress)!.push(tag);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => b - a)
      .map(([congress, congressTags]) => ({
        congress,
        label: `${ordinal(congress)} Congress`,
        years: congressYears(congress),
        tags: congressTags,
        changedCount: congressTags.filter(t => tagChangedThisSection(t.name)).length,
      }));
  }

  let congressGroups = $derived(groupByCongress(tags));

  function sectionPathToParts(path: string): { title: string; section: string } | null {
    const m = /statutes\/(title-[^/]+)\/[^/]+\/(section-[^/]+)\.md$/.exec(path);
    if (!m) return null;
    return { title: m[1] ?? "", section: m[2] ?? "" };
  }

  function pairKey(from: string, to: string): string {
    return `${from}_${to}`;
  }

  function getBaseUrl(): string {
    return document.querySelector('meta[name="base-url"]')?.getAttribute('content') ?? '/us-code-tracker/';
  }

  async function fetchManifest(): Promise<DiffManifest | null> {
    try {
      const res = await fetch(`${getBaseUrl()}diffs/manifest.json`);
      if (!res.ok) return null;
      return (await res.json()) as DiffManifest;
    } catch {
      return null;
    }
  }

  async function fetchStaticDiff(from: string, to: string): Promise<SectionDiff | null> {
    const parts = sectionPathToParts(sectionPath);
    if (!parts) return null;
    try {
      const url = `${getBaseUrl()}diffs/${pairKey(from, to)}/${parts.title}/${parts.section}.json`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return (await res.json()) as SectionDiff;
    } catch {
      return null;
    }
  }

  function cleanMarkdownForDisplay(raw: string): string {
    return raw
      .replace(/^---[\s\S]*?---\n*/m, "")
      .replace(/^# .*/m, "")
      .replace(/- \*\*\(([^)]+)\)\*\*/g, "($1)")
      .replace(/^\s*- /gm, "")
      .trim();
  }

  async function loadHistory() {
    loading = true;
    error = "";
    try {
      const fetchedManifest = await fetchManifest();
      if (fetchedManifest && fetchedManifest.pairs.length > 0) {
        usingStaticDiffs = true;
        manifest = fetchedManifest;
        tags = fetchedManifest.pairs
          .flatMap((p) => [p.from, p.to])
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((name) => ({ name, date: "" }));
        const last = tags[tags.length - 1];
        const secondLast = tags[tags.length - 2];
        if (last) compareTo = last.name;
        if (secondLast) compareFrom = secondLast.name;
        if (tags.length > 0) {
          const latestCongress = parseCongress(tags[tags.length - 1]?.name ?? "");
          if (latestCongress) expandedCongress = new Set([latestCongress]);
        }
        void buildSectionChangePairs();
        try {
          const commitResult = await getFileHistory(repoOwner, repoName, sectionPath, githubToken);
          const seen = new Set<string>();
          commits = commitResult.filter(c => !seen.has(c.message) && seen.add(c.message));
        } catch {
          // Optional
        }
        return;
      }

      const [commitResult, tagResult] = await Promise.all([
        getFileHistory(repoOwner, repoName, sectionPath, githubToken),
        fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/tags?per_page=100`, {
          headers: githubToken ? { Authorization: `token ${githubToken}` } : {},
        }).then(async (r) => {
          if (!r.ok) return [] as ReleaseTag[];
          const data = (await r.json()) as { name: string }[];
          const parseTag = (name: string): [number, number] => {
            const m = /pl-(\d+)-(\d+)/.exec(name);
            return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [0, 0];
          };
          return data
            .filter((t) => t.name.startsWith("pl-"))
            .map((t): ReleaseTag => ({ name: t.name, date: "" }))
            .sort((a, b) => {
              const [ac, al] = parseTag(a.name);
              const [bc, bl] = parseTag(b.name);
              return ac !== bc ? ac - bc : al - bl;
            });
        }),
      ]);
      const seen = new Set<string>();
      commits = commitResult.filter(c => !seen.has(c.message) && seen.add(c.message));
      tags = tagResult;
      if (tags.length > 0) {
        compareTo = tags[tags.length - 1]?.name ?? "";
        if (tags.length > 1) compareFrom = tags[tags.length - 2]?.name ?? "";
        const latestCongress = parseCongress(tags[tags.length - 1]?.name ?? "");
        if (latestCongress) expandedCongress = new Set([latestCongress]);
      }
    } catch (e: unknown) {
      error = isRateLimited(e)
        ? "GitHub API rate limit reached. Try again later or provide a token."
        : e instanceof Error ? e.message : "Failed to load history";
    } finally {
      loading = false;
    }
  }

  async function compareVersions() {
    if (!compareFrom || !compareTo) return;
    diffLoading = true;
    error = "";
    try {
      if (usingStaticDiffs) {
        const staticDiff = await fetchStaticDiff(compareFrom, compareTo);
        if (staticDiff) {
          diffLines = staticDiff.lines;
        } else {
          diffLines = [];
        }
        hasCompared = true;
        return;
      }

      const result = await getFileDiff({
        owner: repoOwner, repo: repoName,
        base: compareFrom, head: compareTo,
        path: sectionPath, token: githubToken,
      });
      diffLines = result ?? [];
      hasCompared = true;
    } catch (e: unknown) {
      error = isRateLimited(e)
        ? "GitHub API rate limit reached. Try again later or provide a token."
        : e instanceof Error ? e.message : "Failed to load diff";
    } finally {
      diffLoading = false;
    }
  }

  async function viewTag(tag: ReleaseTag) {
    selectedTag = tag.name;
    selectedTagContent = "";
    tagLoading = true;
    error = "";
    try {
      const content = await getFileAtRef(repoOwner, repoName, sectionPath, tag.name, githubToken);
      selectedTagContent = content ? cleanMarkdownForDisplay(content) : "File not found at this version.";
    } finally {
      tagLoading = false;
    }
  }

  function toggleCongress(congress: number) {
    const next = new Set(expandedCongress);
    if (next.has(congress)) {
      next.delete(congress);
    } else {
      next.add(congress);
    }
    expandedCongress = next;
  }

  function formatCommitMessage(msg: string): string {
    const plMatch = /Update to (?:PL |Public Law )?([\d-]+)/i.exec(msg);
    if (plMatch) return `Updated to Public Law ${plMatch[1]}`;
    if (/regenerate|reformat|markdown/i.test(msg)) return "Formatting update";
    if (/import|initial/i.test(msg)) return "Initial import";
    return msg.replace(/^(?:chore|feat|fix)\([^)]*\):\s*/i, "");
  }

  function isLegislativeChange(msg: string): boolean {
    return /Update to (?:PL |Public Law )/i.test(msg);
  }

  function commitDisplayDate(msg: string, gitDate: string): string {
    const m = msg.match(/(\d{3})-(\d+)/);
    if (m) return `${2013 + (parseInt(m[1]) - 113) * 2}`;
    return gitDate ? new Date(gitDate).toLocaleDateString() : '';
  }

  let currentTag = $derived(tags.length > 0 ? tags[tags.length - 1]?.name ?? "" : "");

  $effect(() => { void loadHistory(); });
</script>

<div id="diff-viewer" class="rounded-lg border border-gray-200 bg-white p-5 font-sans text-sm shadow-xs dark:border-gray-800 dark:bg-[#0B1926]">
  {#if loading}
    <p class="text-gray-500">Loading version history...</p>
  {:else if error}
    <p class="text-crimson dark:text-red-400">{error}</p>
  {:else}
    <!-- Historical version warning banner -->
    {#if selectedTag && selectedTag !== currentTag}
      <div class="mb-5 flex items-center gap-2.5 rounded-lg border border-amber/40 bg-amber-light/30 px-3.5 py-2.5 dark:border-amber-600/40 dark:bg-amber-950/40">
        <svg class="h-4 w-4 shrink-0 text-amber dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M12 3l9.09 16.91H2.91L12 3z" />
        </svg>
        <span class="text-xs font-medium text-slate dark:text-gray-200">
          Viewing historical version at <strong>{formatTagName(selectedTag)}</strong> &mdash; this is not current law.
          <button class="ml-1 text-teal underline hover:text-navy dark:text-teal-bright" onclick={() => { selectedTagContent = ""; selectedTag = ""; }}>
            Switch to current law &rarr;
          </button>
        </span>
      </div>
    {/if}

    {#if tags.length > 0}
      <!-- Version Timeline (Congress Groups) -->
      <div class="mb-5">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <h3 class="text-base font-bold text-navy dark:text-gray-100">Legislative Version Timeline</h3>
            <p class="text-xs text-slate dark:text-gray-400">Release points published by the Office of the Law Revision Counsel.</p>
          </div>
          <label class="flex items-center gap-1.5 text-xs text-slate dark:text-gray-400 cursor-pointer">
            <input type="checkbox" bind:checked={onlyShowChanges} class="h-3.5 w-3.5 rounded border-gray-300 accent-teal" />
            <span>Changes only</span>
          </label>
        </div>

        <div class="space-y-1.5">
          {#each congressGroups as group (group.congress)}
            {@const isExpanded = expandedCongress.has(group.congress)}
            {@const visibleTags = onlyShowChanges ? group.tags.filter(t => tagChangedThisSection(t.name)) : group.tags}
            <div class="rounded-md border border-gray-100 dark:border-gray-800 overflow-hidden">
              <button
                class="flex w-full items-center justify-between bg-warm-gray/50 px-3.5 py-2 text-left text-xs transition-colors hover:bg-warm-gray dark:bg-gray-850 dark:hover:bg-gray-800"
                onclick={() => toggleCongress(group.congress)}
              >
                <span class="flex items-center gap-2">
                  <svg class="h-3.5 w-3.5 text-gray-400 transition-transform {isExpanded ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  <span class="font-semibold text-navy dark:text-gray-200">{group.label}</span>
                  <span class="text-gray-400">({group.years})</span>
                </span>
                <span class="flex items-center gap-2">
                  {#if group.changedCount > 0}
                    <span class="rounded-full bg-teal/15 px-2 py-0.5 text-[10px] font-semibold text-teal dark:bg-teal/20 dark:text-teal-bright">
                      {group.changedCount} modified
                    </span>
                  {/if}
                  <span class="text-[11px] text-gray-400">{group.tags.length} releases</span>
                </span>
              </button>

              {#if isExpanded}
                <div class="border-t border-gray-100 bg-white px-3.5 py-2.5 dark:border-gray-800 dark:bg-[#0B1926]">
                  {#if visibleTags.length === 0}
                    <p class="py-1 text-xs text-gray-400">No modifications tracked for this section in the {group.label}.</p>
                  {:else}
                    <div class="flex flex-wrap gap-1.5">
                      {#each visibleTags as tag (tag.name)}
                        {@const changed = tagChangedThisSection(tag.name)}
                        <button
                          class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors {
                            selectedTag === tag.name
                              ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-400 dark:bg-amber-900/40 dark:text-amber-200'
                              : changed
                              ? 'bg-teal/10 text-teal hover:bg-teal/20 dark:bg-teal/20 dark:text-teal-bright'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                          }"
                          onclick={() => void viewTag(tag)}
                          title="{formatTagName(tag.name)} ({extractYear(tag.date, tag.name)})"
                        >
                          <span class="h-1.5 w-1.5 rounded-full {selectedTag === tag.name ? 'bg-amber' : changed ? 'bg-teal' : 'bg-gray-400'}"></span>
                          <span>{formatTagName(tag.name)}</span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      {#if tagLoading}
        <p class="mb-4 text-xs text-gray-500">Loading version content...</p>
      {:else if selectedTagContent}
        <div class="mb-5 rounded-lg border border-gray-200 bg-warm-white dark:border-gray-700 dark:bg-gray-900">
          <div class="flex items-center justify-between border-b border-gray-200 bg-warm-gray px-3.5 py-2 text-xs font-semibold text-navy dark:border-gray-800 dark:bg-gray-800 dark:text-amber">
            <span>Historical Text at {formatTagName(selectedTag)}</span>
            <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" onclick={() => { selectedTagContent = ""; selectedTag = ""; }}>&times; Close</button>
          </div>
          <pre class="max-h-64 overflow-auto p-4 font-mono text-xs leading-relaxed text-slate dark:text-gray-200">{selectedTagContent}</pre>
        </div>
      {/if}

      <!-- Compare Versions Control Bar -->
      <div class="border-t border-gray-200 pt-5 dark:border-gray-800">
        <h3 class="mb-1 text-base font-bold text-navy dark:text-gray-100">Compare Statutory Releases</h3>
        <p class="mb-3 text-xs text-slate dark:text-gray-400">View word-level additions and deletions between any two federal law releases.</p>

        <div class="flex flex-wrap items-center gap-3">
          <label class="text-xs text-slate dark:text-gray-300">
            Base:
            <select class="ml-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" bind:value={compareFrom}>
              {#each congressGroups as group (group.congress)}
                <optgroup label="{group.label} ({group.years})">
                  {#each group.tags as tag (tag.name)}
                    <option value={tag.name}>{formatTagName(tag.name)}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
          </label>

          <label class="text-xs text-slate dark:text-gray-300">
            Compare:
            <select class="ml-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" bind:value={compareTo}>
              {#each congressGroups as group (group.congress)}
                <optgroup label="{group.label} ({group.years})">
                  {#each group.tags as tag (tag.name)}
                    <option value={tag.name}>{formatTagName(tag.name)}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
          </label>

          <button
            class="rounded-md bg-teal px-4 py-1 text-xs font-semibold text-white shadow-2xs hover:bg-teal/90 disabled:opacity-50 transition-colors"
            onclick={() => void compareVersions()}
            disabled={diffLoading || !compareFrom || !compareTo || compareFrom === compareTo}
          >
            {diffLoading ? "Comparing..." : "Compare"}
          </button>
        </div>
      </div>

      {#if diffLines.length > 0}
        <div class="mt-5">
          <!-- Diff Toolbar & Mode Switcher -->
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2 dark:border-gray-800">
            <!-- Mode Switcher -->
            <div class="inline-flex rounded-md border border-gray-300 bg-white p-0.5 shadow-2xs dark:border-gray-700 dark:bg-gray-800" role="group" aria-label="Diff view format">
              <button
                onclick={() => diffMode = "redline"}
                class="rounded px-2.5 py-1 text-xs font-medium transition-colors {diffMode === 'redline' ? 'bg-navy text-white dark:bg-teal' : 'text-slate hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}"
              >
                Legal Redline
              </button>
              <button
                onclick={() => diffMode = "split"}
                class="rounded px-2.5 py-1 text-xs font-medium transition-colors {diffMode === 'split' ? 'bg-navy text-white dark:bg-teal' : 'text-slate hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}"
              >
                Side-by-Side
              </button>
              <button
                onclick={() => diffMode = "raw"}
                class="rounded px-2.5 py-1 text-xs font-medium transition-colors {diffMode === 'raw' ? 'bg-navy text-white dark:bg-teal' : 'text-slate hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}"
              >
                Git Patch
              </button>
            </div>

            <!-- Metrics Pill -->
            <div class="flex items-center gap-3 text-xs">
              <span class="text-slate dark:text-gray-400 font-medium">{formatTagName(compareFrom)} &rarr; {formatTagName(compareTo)}</span>
              <span class="inline-flex items-center gap-1 rounded bg-teal/10 px-2 py-0.5 font-semibold text-teal dark:bg-teal/20 dark:text-teal-bright">
                +{diffMetrics.additions} lines
              </span>
              <span class="inline-flex items-center gap-1 rounded bg-crimson/10 px-2 py-0.5 font-semibold text-crimson dark:bg-crimson/20 dark:text-red-400">
                -{diffMetrics.deletions} lines
              </span>
            </div>
          </div>

          <!-- Display Mode 1: Legal Redline (Word-Level Intraline) -->
          {#if diffMode === "redline"}
            <div class="max-h-[500px] overflow-auto rounded-lg border border-gray-200 bg-warm-white p-4 font-serif text-sm leading-relaxed text-slate shadow-2xs dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
              {#each redlineRows as row}
                {#if row.type === "paired" && row.tokens}
                  <p class="my-2 border-l-2 border-teal pl-3">
                    {#each row.tokens as token}
                      {#if token.type === "del"}
                        <del class="diff-del">{token.text}</del>
                      {:else if token.type === "add"}
                        <ins class="diff-add">{token.text}</ins>
                      {:else}
                        <span>{token.text}</span>
                      {/if}
                    {/each}
                  </p>
                {:else if row.type === "del"}
                  <p class="my-2 border-l-2 border-crimson pl-3">
                    <del class="diff-del">{row.content}</del>
                  </p>
                {:else if row.type === "add"}
                  <p class="my-2 border-l-2 border-teal pl-3">
                    <ins class="diff-add">{row.content}</ins>
                  </p>
                {:else}
                  <p class="my-1.5 text-gray-600 dark:text-gray-400">{row.content}</p>
                {/if}
              {/each}
            </div>

          <!-- Display Mode 2: Side-by-Side (Split) View -->
          {:else if diffMode === "split"}
            <div class="max-h-[500px] overflow-auto rounded-lg border border-gray-200 bg-white font-mono text-xs dark:border-gray-800 dark:bg-gray-950">
              <div class="grid grid-cols-2 border-b border-gray-200 bg-warm-gray text-[11px] font-semibold text-slate dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                <div class="border-r border-gray-200 px-3 py-1.5 dark:border-gray-800">
                  Previous: {formatTagName(compareFrom)}
                </div>
                <div class="px-3 py-1.5">
                  Revised: {formatTagName(compareTo)}
                </div>
              </div>
              <div class="divide-y divide-gray-100 dark:divide-gray-900">
                {#each diffLines as line}
                  <div class="grid grid-cols-2">
                    <!-- Left (Previous) -->
                    <div class="border-r border-gray-200 px-3 py-1 overflow-x-auto dark:border-gray-800 {line.type === 'del' ? 'bg-red-50 text-crimson dark:bg-red-950/40 dark:text-red-300 font-semibold' : ''}">
                      {line.type === 'del' || line.type === 'context' ? line.content : ''}
                    </div>
                    <!-- Right (Revised) -->
                    <div class="px-3 py-1 overflow-x-auto {line.type === 'add' ? 'bg-teal-50 text-teal dark:bg-teal-950/40 dark:text-teal-bright font-semibold' : ''}">
                      {line.type === 'add' || line.type === 'context' ? line.content : ''}
                    </div>
                  </div>
                {/each}
              </div>
            </div>

          <!-- Display Mode 3: Raw Unified Git Patch -->
          {:else}
            <pre class="max-h-[500px] overflow-auto rounded-lg bg-gray-50 p-4 font-mono text-xs leading-5 dark:bg-gray-950">{#each diffLines as line}<span class="{line.type === 'add'
  ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
  : line.type === 'del'
    ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
    : 'text-gray-600 dark:text-gray-400'} block">{line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  '}{line.content}</span>{/each}</pre>
          {/if}
        </div>
      {:else if hasCompared && !diffLoading && compareFrom && compareTo && compareFrom !== compareTo}
        <div class="mt-4 rounded-lg bg-warm-gray p-4 text-center text-xs text-slate dark:bg-gray-800 dark:text-gray-300">
          <p class="font-semibold text-navy dark:text-amber">No textual changes detected</p>
          <p class="mt-0.5">The statutory text of this section remained identical between {formatTagName(compareFrom)} and {formatTagName(compareTo)}.</p>
        </div>
      {/if}
    {/if}

    <!-- Git Commit History -->
    <div class="mt-6 border-t border-gray-200 pt-5 dark:border-gray-800">
      <h3 class="mb-2 text-base font-bold text-navy dark:text-gray-100">Pipeline Commit Audit</h3>
      {#if commits.length === 0}
        <div class="rounded-lg bg-warm-gray p-4 text-center text-xs text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
          <p>No amendments tracked yet for this section.</p>
          <p class="mt-1 text-[11px]">Commit history will populate automatically as new Public Law releases are published by OLRC.</p>
        </div>
      {:else}
        {#if tags.length === 0}
          <p class="mb-3 rounded bg-teal/10 p-2 text-xs text-teal dark:text-teal-300">Version timeline available when release point tags are published.</p>
        {:else if !commits.some(c => isLegislativeChange(c.message))}
          <p class="mb-3 rounded bg-amber/10 p-2 text-xs text-amber dark:bg-amber/5">No legislative changes tracked yet. Future updates will appear here as diffs.</p>
        {/if}
        {@const visibleCommits = showAllHistory ? commits : commits.slice(0, HISTORY_PREVIEW_COUNT)}
        <ul class="max-h-48 space-y-1 overflow-y-auto">
          {#each visibleCommits as commit (commit.sha)}
            <li class="flex items-center justify-between rounded px-2.5 py-1.5 text-xs text-slate hover:bg-warm-gray dark:text-gray-300 dark:hover:bg-gray-800">
              <span class="font-medium">{formatCommitMessage(commit.message)}</span>
              <span class="font-mono text-[11px] text-gray-400">{commitDisplayDate(commit.message, commit.date)}</span>
            </li>
          {/each}
        </ul>
        {#if commits.length > HISTORY_PREVIEW_COUNT}
          <button
            class="mt-2 text-xs font-medium text-teal hover:underline dark:text-teal-bright"
            onclick={() => showAllHistory = !showAllHistory}
          >
            {showAllHistory ? `Show recent ${HISTORY_PREVIEW_COUNT}` : `Show all ${commits.length} commits`}
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<script lang="ts">
  import {
    getFileHistory, getFileDiff, getFileAtRef,
    isRateLimited, formatTagName, extractYear,
    type CommitInfo, type DiffLine, type ReleaseTag,
  } from "../lib/github";
  import { computeWordDiff, type WordToken } from "../lib/word-diff";

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

  // Navigation & View State
  let activeTab = $state<"compare" | "timeline" | "audit">("compare");
  let diffMode = $state<"redline" | "split" | "raw">("redline");
  let selectedCongressFilter = $state<number | null>(null);
  let onlyShowChanges = $state(true);
  let showAllHistory = $state(false);
  const HISTORY_PREVIEW_COUNT = 8;

  // Data State
  let commits = $state<CommitInfo[]>([]);
  let tags = $state<ReleaseTag[]>([]);
  let diffLines = $state<DiffLine[]>([]);
  let loading = $state(false);
  let diffLoading = $state(false);
  let tagLoading = $state(false);
  let error = $state("");
  let copyFeedback = $state(false);

  // Comparison State
  let compareFrom = $state("");
  let compareTo = $state("");
  let selectedTagContent = $state("");
  let selectedTag = $state("");
  let hasCompared = $state(false);
  let usingStaticDiffs = $state(false);
  let manifest = $state<DiffManifest | null>(null);
  let sectionChangePairs = $state<Set<string>>(new Set());

  /** Build redline rows by pairing consecutive del and add lines */
  let redlineRows = $derived.by<RedlineRow[]>(() => {
    const rows: RedlineRow[] = [];
    let i = 0;
    while (i < diffLines.length) {
      const current = diffLines[i]!;
      if (current.type === "del") {
        const next = diffLines[i + 1];
        if (next && next.type === "add") {
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

  /** Check if a tag changed this section */
  function tagChangedThisSection(tagName: string): boolean {
    if (sectionChangePairs.size === 0) return true;
    return sectionChangePairs.has(tagName);
  }

  function sectionPathToParts(path: string): { title: string; section: string } | null {
    const m = /statutes\/(title-[^/]+)\/[^/]+\/(section-[^/]+)\.md$/.exec(path);
    if (!m) return null;
    return { title: m[1] ?? "", section: m[2] ?? "" };
  }

  function pairKey(from: string, to: string): string {
    return `${from}_${to}`;
  }

  function getBaseUrl(): string {
    return typeof document !== "undefined"
      ? document.querySelector('meta[name="base-url"]')?.getAttribute("content") ?? "/us-code-tracker/"
      : "/us-code-tracker/";
  }

  async function buildSectionChangePairs(): Promise<void> {
    const parts = sectionPathToParts(sectionPath);
    if (!parts) return;
    const baseUrl = getBaseUrl();

    // 1. Instant single-fetch lookup via precomputed changed-sections.json
    try {
      const res = await fetch(`${baseUrl}diffs/changed-sections.json`);
      if (res.ok) {
        const index = (await res.json()) as Record<string, string[]>;
        const key = `${parts.title}/${parts.section}`;
        const changedList = index[key];
        if (changedList && Array.isArray(changedList)) {
          const set = new Set(changedList);
          if (tags.length > 0 && tags[0]) set.add(tags[0].name);
          sectionChangePairs = set;
          return;
        }
      }
    } catch {
      // Fall through to manifest probe
    }

    // 2. Fallback: probe manifest pairs if index is missing
    if (!manifest) return;
    const changed = new Set<string>();
    if (tags.length > 0 && tags[0]) changed.add(tags[0].name);

    for (const pair of manifest.pairs.slice(0, 10)) {
      try {
        const url = `${baseUrl}diffs/${pair.from}_${pair.to}/${parts.title}/${parts.section}.json`;
        const res = await fetch(url, { method: "HEAD" });
        if (res.ok) changed.add(pair.to);
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
        changedCount: congressTags.filter((t) => tagChangedThisSection(t.name)).length,
      }));
  }

  let congressGroups = $derived(groupByCongress(tags));

  let currentCongress = $derived(
    tags.length > 0 ? parseCongress(tags[tags.length - 1]?.name ?? "") : 119
  );

  let currentTag = $derived(tags.length > 0 ? tags[tags.length - 1]?.name ?? "" : "");

  let activeCongressGroup = $derived(
    congressGroups.find((g) => g.congress === (selectedCongressFilter ?? currentCongress)) ??
      congressGroups[0]
  );

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

        await buildSectionChangePairs();

        try {
          const commitResult = await getFileHistory(repoOwner, repoName, sectionPath, githubToken);
          const seen = new Set<string>();
          commits = commitResult.filter((c) => !seen.has(c.message) && seen.add(c.message));
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
      commits = commitResult.filter((c) => !seen.has(c.message) && seen.add(c.message));
      tags = tagResult;
      if (tags.length > 0) {
        compareTo = tags[tags.length - 1]?.name ?? "";
        if (tags.length > 1) compareFrom = tags[tags.length - 2]?.name ?? "";
      }
    } catch (e: unknown) {
      error = isRateLimited(e)
        ? "GitHub API rate limit reached. Try again later or provide a token."
        : e instanceof Error
          ? e.message
          : "Failed to load history";
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
        diffLines = staticDiff ? staticDiff.lines : [];
        hasCompared = true;
        return;
      }

      const result = await getFileDiff({
        owner: repoOwner,
        repo: repoName,
        base: compareFrom,
        head: compareTo,
        path: sectionPath,
        token: githubToken,
      });
      diffLines = result ?? [];
      hasCompared = true;
    } catch (e: unknown) {
      error = isRateLimited(e)
        ? "GitHub API rate limit reached. Try again later or provide a token."
        : e instanceof Error
          ? e.message
          : "Failed to load diff";
    } finally {
      diffLoading = false;
    }
  }

  function swapVersions() {
    const temp = compareFrom;
    compareFrom = compareTo;
    compareTo = temp;
    if (hasCompared) {
      void compareVersions();
    }
  }

  function applyPreset(preset: "latest" | "congress" | "all") {
    if (tags.length === 0) return;
    if (preset === "latest") {
      const changedTags = tags.filter((t) => tagChangedThisSection(t.name));
      if (changedTags.length >= 2) {
        compareFrom = changedTags[changedTags.length - 2]!.name;
        compareTo = changedTags[changedTags.length - 1]!.name;
      } else {
        compareTo = tags[tags.length - 1]?.name ?? "";
        compareFrom = tags[tags.length - 2]?.name ?? tags[0]?.name ?? "";
      }
    } else if (preset === "congress") {
      const congTags = tags.filter((t) => parseCongress(t.name) === currentCongress);
      if (congTags.length > 0) {
        compareFrom = congTags[0]!.name;
        compareTo = congTags[congTags.length - 1]!.name;
      }
    } else if (preset === "all") {
      compareFrom = tags[0]?.name ?? "";
      compareTo = tags[tags.length - 1]?.name ?? "";
    }
    activeTab = "compare";
    void compareVersions();
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

  function compareWithCurrent(tagName: string) {
    compareFrom = tagName;
    compareTo = currentTag;
    activeTab = "compare";
    selectedTagContent = "";
    selectedTag = "";
    void compareVersions();
  }

  async function copyPatchToClipboard() {
    const patchText = diffLines
      .map((l) => (l.type === "add" ? `+ ${l.content}` : l.type === "del" ? `- ${l.content}` : `  ${l.content}`))
      .join("\n");
    try {
      await navigator.clipboard.writeText(patchText);
      copyFeedback = true;
      setTimeout(() => (copyFeedback = false), 2000);
    } catch {
      // Clipboard blocked
    }
  }

  function formatCommitMessage(msg: string): string {
    const plMatch = /Update to (?:PL |Public Law )?([\d-]+)/i.exec(msg);
    if (plMatch) return `Updated to Public Law ${plMatch[1]}`;
    if (/regenerate|reformat|markdown/i.test(msg)) return "Formatting update";
    if (/import|initial/i.test(msg)) return "Initial import";
    return msg.replace(/^(?:chore|feat|fix)\([^)]*\):\s*/i, "");
  }

  function commitDisplayDate(msg: string, gitDate: string): string {
    const m = msg.match(/(\d{3})-(\d+)/);
    if (m) return `${2013 + (parseInt(m[1]!, 10) - 113) * 2}`;
    return gitDate ? new Date(gitDate).toLocaleDateString() : "";
  }

  $effect(() => {
    void loadHistory();
  });
</script>

<div
  id="diff-viewer"
  class="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-raised)] p-5 sm:p-6 font-sans text-sm shadow-2xs transition-colors"
>
  {#if loading}
    <div class="flex items-center gap-3 py-8 justify-center text-[var(--text-muted)]">
      <svg class="h-5 w-5 animate-spin text-[var(--civic-action)]" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
      <span class="text-xs font-medium">Loading version intelligence and release pairs…</span>
    </div>
  {:else if error}
    <div class="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-700 dark:text-red-400">
      <p class="font-bold">Error loading statutory history:</p>
      <p class="mt-1 font-mono">{error}</p>
    </div>
  {:else}
    <!-- OpenDesign Workbench Header & Navigation Tabs -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
      <div>
        <div class="flex items-center gap-2">
          <span class="rounded bg-[var(--civic-action)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--civic-action)]">
            OpenLaw Git Workbench
          </span>
          {#if usingStaticDiffs}
            <span class="hidden sm:inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
              Static Verified
            </span>
          {/if}
        </div>
        <h3 class="mt-1 text-lg font-bold text-[var(--text-primary)]">
          Statutory Version Intelligence &amp; Diffs
        </h3>
      </div>

      <!-- Workbench Navigation Tabs -->
      <div class="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] p-1 shadow-2xs self-start sm:self-auto" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === "compare"}
          onclick={() => (activeTab = "compare")}
          class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors {activeTab === 'compare' ? 'bg-[var(--surface-raised)] text-[var(--civic-navy)] dark:text-[var(--text-primary)] shadow-2xs' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          Compare Releases
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "timeline"}
          onclick={() => (activeTab = "timeline")}
          class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors {activeTab === 'timeline' ? 'bg-[var(--surface-raised)] text-[var(--civic-navy)] dark:text-[var(--text-primary)] shadow-2xs' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Version Timeline
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "audit"}
          onclick={() => (activeTab = "audit")}
          class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors {activeTab === 'audit' ? 'bg-[var(--surface-raised)] text-[var(--civic-navy)] dark:text-[var(--text-primary)] shadow-2xs' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Commit Ledger
        </button>
      </div>
    </div>

    <!-- TAB 1: COMPARE STATUTORY RELEASES -->
    {#if activeTab === "compare"}
      <div class="mt-5 space-y-5">
        <!-- Quick Preset Triggers Bar -->
        <div class="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-semibold text-[var(--text-muted)]">Quick Presets:</span>
            <button
              onclick={() => applyPreset("latest")}
              class="rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] shadow-2xs hover:bg-[var(--surface-canvas)] hover:border-[var(--civic-action)] transition-colors"
            >
              ⚡ Latest Revision
            </button>
            <button
              onclick={() => applyPreset("congress")}
              class="rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] shadow-2xs hover:bg-[var(--surface-canvas)] hover:border-[var(--civic-action)] transition-colors"
            >
              🏛️ {ordinal(currentCongress)} Congress Net
            </button>
            <button
              onclick={() => applyPreset("all")}
              class="rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] shadow-2xs hover:bg-[var(--surface-canvas)] hover:border-[var(--civic-action)] transition-colors"
            >
              📜 All Enacted Changes
            </button>
          </div>
          <span class="text-[11px] text-[var(--text-muted)] font-mono">
            {tags.length} official releases tracked
          </span>
        </div>

        <!-- Dual Release Selectors Card -->
        <div class="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4">
          <div class="grid grid-cols-1 md:grid-cols-11 gap-3 items-center">
            <!-- Base Version -->
            <div class="md:col-span-5">
              <label for="base-version" class="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                Base Release (Pre-Amendment)
              </label>
              <select
                id="base-version"
                bind:value={compareFrom}
                class="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--civic-action)]"
              >
                {#each congressGroups as group (group.congress)}
                  <optgroup label="{group.label} ({group.years})">
                    {#each group.tags as tag (tag.name)}
                      <option value={tag.name}>
                        {formatTagName(tag.name)} {tagChangedThisSection(tag.name) ? "• (Amended)" : ""}
                      </option>
                    {/each}
                  </optgroup>
                {/each}
              </select>
            </div>

            <!-- Swap Direction Button -->
            <div class="md:col-span-1 flex justify-center pt-2 md:pt-4">
              <button
                onclick={swapVersions}
                title="Swap Base and Compare releases"
                class="rounded-full border border-[var(--border-default)] bg-[var(--surface-raised)] p-2 text-[var(--text-secondary)] shadow-2xs hover:bg-[var(--surface-canvas)] hover:text-[var(--civic-action)] transition-colors"
                aria-label="Swap releases"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </button>
            </div>

            <!-- Target Version -->
            <div class="md:col-span-5">
              <label for="compare-version" class="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                Compare Target (Post-Amendment)
              </label>
              <div class="flex gap-2">
                <select
                  id="compare-version"
                  bind:value={compareTo}
                  class="flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--civic-action)]"
                >
                  {#each congressGroups as group (group.congress)}
                    <optgroup label="{group.label} ({group.years})">
                      {#each group.tags as tag (tag.name)}
                        <option value={tag.name}>
                          {formatTagName(tag.name)} {tagChangedThisSection(tag.name) ? "• (Amended)" : ""}
                        </option>
                      {/each}
                    </optgroup>
                  {/each}
                </select>

                <button
                  onclick={() => void compareVersions()}
                  disabled={diffLoading || !compareFrom || !compareTo || compareFrom === compareTo}
                  class="rounded-lg bg-[var(--civic-navy)] px-4 py-2 text-xs font-bold text-white shadow-2xs hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {diffLoading ? "Diffing…" : "Inspect"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Diff Results Display -->
        {#if diffLines.length > 0}
          <div class="rounded-xl border border-[var(--border-default)] bg-[var(--surface-raised)] overflow-hidden shadow-2xs">
            <!-- Format Switcher & Metrics Header -->
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-3">
              <!-- View Mode Switcher -->
              <div class="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] p-0.5 shadow-2xs" role="radiogroup" aria-label="Diff view format">
                <button
                  onclick={() => (diffMode = "redline")}
                  class="rounded-md px-3 py-1 text-xs font-semibold transition-colors {diffMode === 'redline' ? 'bg-[var(--civic-navy)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]'}"
                  role="radio"
                  aria-checked={diffMode === 'redline'}
                >
                  Legal Redline
                </button>
                <button
                  onclick={() => (diffMode = "split")}
                  class="rounded-md px-3 py-1 text-xs font-semibold transition-colors {diffMode === 'split' ? 'bg-[var(--civic-navy)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]'}"
                  role="radio"
                  aria-checked={diffMode === 'split'}
                >
                  Side-by-Side
                </button>
                <button
                  onclick={() => (diffMode = "raw")}
                  class="rounded-md px-3 py-1 text-xs font-semibold transition-colors {diffMode === 'raw' ? 'bg-[var(--civic-navy)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]'}"
                  role="radio"
                  aria-checked={diffMode === 'raw'}
                >
                  Git Patch
                </button>
              </div>

              <!-- Changes Metric Badge & Copy -->
              <div class="flex items-center gap-3">
                <span class="font-mono text-xs text-[var(--text-muted)]">
                  {formatTagName(compareFrom)} &rarr; {formatTagName(compareTo)}
                </span>
                <span class="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                  +{diffMetrics.additions} lines
                </span>
                <span class="inline-flex items-center gap-1 rounded bg-red-500/10 px-2 py-0.5 text-xs font-bold text-red-700 dark:text-red-400">
                  -{diffMetrics.deletions} lines
                </span>
                <button
                  onclick={copyPatchToClipboard}
                  class="rounded border border-[var(--border-default)] bg-[var(--surface-raised)] px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {copyFeedback ? "✓ Copied" : "Copy Patch"}
                </button>
              </div>
            </div>

            <!-- MODE 1: LEGAL REDLINE (Intraline word-level) -->
            {#if diffMode === "redline"}
              <div class="max-h-[600px] overflow-y-auto p-5 font-serif text-sm leading-relaxed text-[var(--text-primary)] bg-[var(--surface-raised)]">
                {#each redlineRows as row}
                  {#if row.type === "paired" && row.tokens}
                    <p class="my-3 border-l-3 border-[var(--civic-action)] pl-3.5 bg-[var(--civic-action)]/5 py-1 rounded-r">
                      {#each row.tokens as token}
                        {#if token.type === "del"}
                          <del class="rounded bg-red-500/15 px-1 py-0.5 text-red-700 dark:text-red-300 line-through decoration-red-500/60 font-sans text-xs">
                            {token.text}
                          </del>
                        {:else if token.type === "add"}
                          <ins class="rounded bg-emerald-500/15 px-1 py-0.5 text-emerald-800 dark:text-emerald-300 no-underline font-semibold border-b-2 border-emerald-500 font-sans text-xs">
                            {token.text}
                          </ins>
                        {:else}
                          <span>{token.text}</span>
                        {/if}
                      {/each}
                    </p>
                  {:else if row.type === "del"}
                    <p class="my-2 border-l-3 border-red-500 pl-3.5 bg-red-500/5 py-1 rounded-r">
                      <del class="rounded bg-red-500/15 px-1 py-0.5 text-red-700 dark:text-red-300 line-through decoration-red-500/60 font-sans text-xs">
                        {row.content}
                      </del>
                    </p>
                  {:else if row.type === "add"}
                    <p class="my-2 border-l-3 border-emerald-500 pl-3.5 bg-emerald-500/5 py-1 rounded-r">
                      <ins class="rounded bg-emerald-500/15 px-1 py-0.5 text-emerald-800 dark:text-emerald-300 no-underline font-semibold border-b-2 border-emerald-500 font-sans text-xs">
                        {row.content}
                      </ins>
                    </p>
                  {:else}
                    <p class="my-1.5 text-[var(--text-secondary)]">{row.content}</p>
                  {/if}
                {/each}
              </div>

            <!-- MODE 2: SIDE-BY-SIDE (Split) VIEW -->
            {:else if diffMode === "split"}
              <div class="max-h-[600px] overflow-auto font-mono text-xs">
                <div class="grid grid-cols-2 sticky top-0 z-10 border-b border-[var(--border-default)] bg-[var(--surface-sunken)] font-sans text-xs font-bold text-[var(--text-secondary)]">
                  <div class="border-r border-[var(--border-default)] px-4 py-2">
                    Base: {formatTagName(compareFrom)}
                  </div>
                  <div class="px-4 py-2">
                    Revised: {formatTagName(compareTo)}
                  </div>
                </div>
                <div class="divide-y divide-[var(--border-subtle)]">
                  {#each diffLines as line}
                    <div class="grid grid-cols-2">
                      <div class="border-r border-[var(--border-default)] px-3 py-1.5 overflow-x-auto {line.type === 'del' ? 'bg-red-500/10 text-red-700 dark:text-red-300 font-semibold' : ''}">
                        {line.type === 'del' || line.type === 'context' ? line.content : ''}
                      </div>
                      <div class="px-3 py-1.5 overflow-x-auto {line.type === 'add' ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 font-semibold' : ''}">
                        {line.type === 'add' || line.type === 'context' ? line.content : ''}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>

            <!-- MODE 3: RAW UNIFIED GIT PATCH -->
            {:else}
              <pre class="max-h-[600px] overflow-auto p-4 font-mono text-xs leading-5 bg-[var(--surface-sunken)] text-[var(--text-primary)]">{#each diffLines as line}<span class="{line.type === 'add'
                  ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 font-medium'
                  : line.type === 'del'
                  ? 'bg-red-500/15 text-red-700 dark:text-red-300'
                  : 'text-[var(--text-muted)]'} block">{line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  '}{line.content}</span>{/each}</pre>
            {/if}
          </div>
        {:else if hasCompared && !diffLoading && compareFrom && compareTo && compareFrom !== compareTo}
          <div class="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-6 text-center text-xs">
            <svg class="h-6 w-6 mx-auto mb-2 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p class="font-bold text-sm text-[var(--text-primary)]">
              Identical Statutory Text Between Releases
            </p>
            <p class="mt-1 max-w-lg mx-auto text-[var(--text-secondary)]">
              This statutory section remained unchanged between <strong>{formatTagName(compareFrom)}</strong> and <strong>{formatTagName(compareTo)}</strong>. While the enacted public law modified other provisions in the Code, the operative language of this section was not amended.
            </p>
          </div>
        {/if}
      </div>
    {/if}

    <!-- TAB 2: LEGISLATIVE VERSION TIMELINE -->
    {#if activeTab === "timeline"}
      <div class="mt-5 space-y-5">
        <!-- Congress Selector Strip & Filter -->
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
          <div class="flex flex-wrap items-center gap-1.5">
            {#each congressGroups as group (group.congress)}
              <button
                onclick={() => (selectedCongressFilter = group.congress)}
                class="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors {(selectedCongressFilter ?? currentCongress) === group.congress ? 'bg-[var(--civic-navy)] text-white shadow-2xs' : 'bg-[var(--surface-sunken)] text-[var(--text-secondary)] hover:bg-[var(--surface-canvas)]'}"
              >
                {group.label}
                {#if group.changedCount > 0}
                  <span class="ml-1 rounded-full bg-white/20 px-1.5 py-0.2 text-[10px] font-bold">
                    {group.changedCount}
                  </span>
                {/if}
              </button>
            {/each}
          </div>

          <label class="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
            <input type="checkbox" bind:checked={onlyShowChanges} class="rounded border-[var(--border-default)] accent-[var(--civic-action)]" />
            <span>Only show modifying releases</span>
          </label>
        </div>

        <!-- Selected Congress Milestone Rail -->
        {#if activeCongressGroup}
          {@const displayTags = onlyShowChanges
            ? activeCongressGroup.tags.filter((t) => tagChangedThisSection(t.name))
            : activeCongressGroup.tags}

          <div class="flex items-center justify-between">
            <h4 class="text-sm font-bold text-[var(--text-primary)]">
              {activeCongressGroup.label} ({activeCongressGroup.years}) &mdash; {activeCongressGroup.tags.length} Official Releases
            </h4>
            <span class="text-xs text-[var(--text-muted)]">
              {activeCongressGroup.changedCount} legislative modifications
            </span>
          </div>

          {#if displayTags.length === 0}
            <div class="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-6 text-center text-xs text-[var(--text-muted)]">
              No statutory modifications were made to this section in the {activeCongressGroup.label}.
            </div>
          {:else}
            <!-- Chronological Milestone Rail -->
            <div class="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-[var(--border-default)]">
              {#each displayTags as tag (tag.name)}
                {@const isModified = tagChangedThisSection(tag.name)}
                {@const isCurrent = tag.name === currentTag}
                <div class="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-raised)] p-3.5 shadow-2xs hover:border-[var(--civic-action)] transition-colors">
                  <!-- Milestone Indicator Dot -->
                  <div class="absolute -left-6 top-4 h-3 w-3 rounded-full border-2 border-[var(--surface-raised)] {isModified ? 'bg-[var(--civic-action)] ring-4 ring-[var(--civic-action)]/20' : 'bg-[var(--text-muted)]'}"></div>

                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-mono text-xs font-bold text-[var(--text-primary)]">
                        {formatTagName(tag.name)}
                      </span>
                      {#if isCurrent}
                        <span class="rounded bg-[var(--civic-navy)]/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--civic-navy)] dark:text-[var(--text-primary)]">
                          Current Law
                        </span>
                      {/if}
                      {#if isModified}
                        <span class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                          Amended
                        </span>
                      {/if}
                    </div>
                    <p class="text-xs text-[var(--text-muted)] mt-0.5">
                      Enacted in {extractYear(tag.date, tag.name)} &bull; {activeCongressGroup.label}
                    </p>
                  </div>

                  <!-- Quick Actions -->
                  <div class="flex items-center gap-2">
                    <button
                      onclick={() => void viewTag(tag)}
                      class="rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-2.5 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-canvas)] transition-colors"
                    >
                      View Snapshot
                    </button>
                    {#if !isCurrent}
                      <button
                        onclick={() => compareWithCurrent(tag.name)}
                        class="rounded-lg bg-[var(--civic-action)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--civic-action)] hover:bg-[var(--civic-action)]/20 transition-colors"
                      >
                        Diff vs Current &rarr;
                      </button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {/if}

        <!-- Historical Snapshot Prose Reader Modal/Card -->
        {#if tagLoading}
          <div class="py-4 text-center text-xs text-[var(--text-muted)]">
            Loading historical snapshot…
          </div>
        {:else if selectedTagContent}
          <div class="rounded-xl border border-amber-500/30 bg-[var(--surface-raised)] p-5 shadow-2xs font-serif">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[var(--border-subtle)] pb-3 font-sans">
              <div>
                <span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                  Historical Snapshot: {formatTagName(selectedTag)}
                </span>
                <p class="text-xs text-[var(--text-muted)] mt-1">
                  Historical text as codified under {formatTagName(selectedTag)} (Superseded &mdash; not current law).
                </p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  onclick={() => compareWithCurrent(selectedTag)}
                  class="rounded-lg bg-[var(--civic-action)] px-3 py-1 text-xs font-bold text-white shadow-2xs hover:opacity-90 transition-opacity"
                >
                  Diff vs Current Law &rarr;
                </button>
                <button
                  onclick={() => { selectedTagContent = ""; selectedTag = ""; }}
                  class="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Close &times;
                </button>
              </div>
            </div>
            <div class="mt-4 max-h-80 overflow-y-auto whitespace-pre-wrap font-serif text-sm leading-relaxed text-[var(--text-secondary)]">
              {selectedTagContent}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- TAB 3: PIPELINE COMMIT AUDIT -->
    {#if activeTab === "audit"}
      <div class="mt-5 space-y-4">
        <div class="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <div>
            <h4 class="text-sm font-bold text-[var(--text-primary)]">
              Cryptographic Git Commit Ledger
            </h4>
            <p class="text-xs text-[var(--text-muted)]">
              Immutable version history generated from official OLRC U.S. Code releases.
            </p>
          </div>
          <span class="font-mono text-xs text-[var(--text-muted)]">
            {commits.length} commits recorded
          </span>
        </div>

        {#if commits.length === 0}
          <div class="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-6 text-center text-xs text-[var(--text-muted)]">
            No commit ledger history found for this section.
          </div>
        {:else}
          {@const visibleCommits = showAllHistory ? commits : commits.slice(0, HISTORY_PREVIEW_COUNT)}
          <div class="rounded-xl border border-[var(--border-default)] overflow-hidden">
            <table class="w-full text-left text-xs font-sans">
              <thead class="bg-[var(--surface-sunken)] border-b border-[var(--border-default)] font-bold text-[var(--text-muted)]">
                <tr>
                  <th class="px-4 py-2.5">Revision Message</th>
                  <th class="px-4 py-2.5">Commit SHA</th>
                  <th class="px-4 py-2.5 text-right">Codified Year</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--border-subtle)] bg-[var(--surface-raised)]">
                {#each visibleCommits as commit (commit.sha)}
                  <tr class="hover:bg-[var(--surface-sunken)] transition-colors">
                    <td class="px-4 py-2 font-medium text-[var(--text-primary)]">
                      {formatCommitMessage(commit.message)}
                    </td>
                    <td class="px-4 py-2 font-mono text-[11px] text-[var(--civic-action)]">
                      <a
                        href="https://github.com/{repoOwner}/{repoName}/commit/{commit.sha}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hover:underline"
                      >
                        {commit.sha.slice(0, 7)}
                      </a>
                    </td>
                    <td class="px-4 py-2 text-right font-mono text-[11px] text-[var(--text-muted)]">
                      {commitDisplayDate(commit.message, commit.date)}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          {#if commits.length > HISTORY_PREVIEW_COUNT}
            <div class="text-center pt-2">
              <button
                onclick={() => (showAllHistory = !showAllHistory)}
                class="rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                {showAllHistory ? `Show top ${HISTORY_PREVIEW_COUNT} commits` : `Show all ${commits.length} commits`}
              </button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  {/if}
</div>

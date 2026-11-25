<script lang="ts">
  import { sanitizeExcerpt } from "../lib/sanitize";
  import { parseCitation } from "../lib/citation-parser";

  // Pagefind types for the dynamically imported module
  interface PagefindResult {
    id: string;
    data: () => Promise<PagefindResultData>;
  }

  interface PagefindResultData {
    url: string;
    meta: { title?: string };
    excerpt: string;
  }

  interface PagefindResponse {
    results: PagefindResult[];
  }

  interface PagefindModule {
    init: () => Promise<void>;
    search: (query: string) => Promise<PagefindResponse>;
  }

  // USCT-036: Historical release search shard manifest & shard entry schemas
  interface HistoricalReleaseMeta {
    releaseId: string;
    label: string;
    titlesAvailable: string[];
    missingTitles: string[];
    coverageState: 'complete' | 'partial' | 'failed' | 'not_collected';
  }

  interface HistoricalSearchIndexManifest {
    schemaVersion: 'usct.historical-search-manifest/v1';
    generatedForPublicationId: string;
    availableReleases: HistoricalReleaseMeta[];
    shards: Record<string, { shardPath: string; shardDigest: string; entryCount: number }>;
  }

  interface HistoricalSearchShardEntry {
    provisionId: string;
    provisionVersionId: string;
    releaseId: string;
    uscTitle: string;
    uscSection: string;
    citation: string;
    aliases: string[];
    heading: string;
    excerpt: string;
    bodyMarkdown?: string;
    historicalUrl: string;
  }

  interface HistoricalSearchShard {
    schemaVersion: 'usct.historical-search-shard/v1';
    shardId: string;
    releaseId: string;
    publisherReleaseLabel: string;
    uscTitle: string;
    coverageState: 'complete' | 'partial' | 'failed' | 'not_collected';
    entries: HistoricalSearchShardEntry[];
    shardDigest: string;
  }

  let query = $state('');
  let selectedRelease = $state<string>('current');
  let historicalManifest = $state<HistoricalSearchIndexManifest | null>(null);
  let historicalWarning = $state<string | null>(null);
  let results = $state<PagefindResultData[]>([]);
  let loading = $state(false);
  let showResults = $state(false);
  let activeIndex = $state(-1);
  let pagefind = $state<PagefindModule | null>(null);
  let devMode = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const shardCache = new Map<string, HistoricalSearchShard>();

  let citationJump = $derived(parseCitation(query));

  function resolveCitationJumpUrl(jump: { title: string; section: string }): string {
    const base = getBaseUrl();
    if (selectedRelease !== 'current') {
      const shard = shardCache.get(`${selectedRelease}__title-${jump.title}`);
      const match = shard?.entries.find(
        (e) => e.uscTitle === jump.title && e.uscSection === jump.section
      );
      if (match) return match.historicalUrl;
      return `${base}browse/title-${jump.title}/?release=${encodeURIComponent(selectedRelease)}#section-${jump.section}`;
    }
    return `${base}browse/title-${jump.title}/#section-${jump.section}`;
  }

  let citationJumpHref = $derived(
    citationJump
      ? (results.find((r) => r.url.includes(`/section-${citationJump.section}/`))?.url ??
          resolveCitationJumpUrl(citationJump))
      : '#'
  );

  function getBaseUrl(): string {
    if (typeof document !== 'undefined') {
      const meta = document.querySelector('meta[name="base-url"]')?.getAttribute('content');
      if (meta) return meta.endsWith('/') ? meta : `${meta}/`;
    }
    const envBase = import.meta.env.BASE_URL || '/us-code-tracker/';
    return envBase.endsWith('/') ? envBase : `${envBase}/`;
  }

  // Load Pagefind + historical shard manifest on mount + register "/" shortcut
  $effect(() => {
    loadPagefind();
    loadHistoricalManifest();
    function onGlobalKeydown(e: KeyboardEvent): void {
      if (e.key === '/' && !devMode && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      }
    }
    document.addEventListener('keydown', onGlobalKeydown);
    return () => {
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      document.removeEventListener('keydown', onGlobalKeydown);
    };
  });

  async function loadPagefind(): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      const base = getBaseUrl();
      const path = base + 'pagefind/' + 'pagefind.js';
      const mod = (await import(/* @vite-ignore */ path)) as PagefindModule;
      await mod.init();
      pagefind = mod;
    } catch {
      devMode = true;
    }
  }

  async function loadHistoricalManifest(): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      const res = await fetch(`${getBaseUrl()}search-shards/manifest.json`);
      if (!res.ok) return;
      const raw: unknown = await res.json();
      if (
        raw &&
        typeof raw === 'object' &&
        (raw as { schemaVersion?: unknown }).schemaVersion === 'usct.historical-search-manifest/v1'
      ) {
        historicalManifest = raw as HistoricalSearchIndexManifest;
      }
    } catch {
      // Static historical shards optional if not yet built
    }
  }

  // Debounced search triggered by query or selectedRelease changes
  $effect(() => {
    const q = query;
    const rel = selectedRelease;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);

    if (q.length === 0) {
      results = [];
      historicalWarning = null;
      showResults = false;
      return;
    }

    loading = true;
    showResults = true;
    debounceTimer = setTimeout(() => {
      if (rel === 'current') {
        performSearch(q);
      } else {
        performHistoricalSearch(q, rel);
      }
    }, 300);
  });

  async function performSearch(q: string): Promise<void> {
    historicalWarning = null;
    if (!pagefind || q.length === 0) {
      loading = false;
      return;
    }

    try {
      const response = await pagefind.search(q);
      const loaded = await Promise.all(
        response.results.slice(0, 10).map((r) => r.data())
      );
      results = loaded;
    } catch {
      results = [];
    } finally {
      loading = false;
    }
  }

  /**
   * USCT-036: Query bounded static historical release search shards without ever falling back
   * to current-release Pagefind text when a historical shard or release is unavailable.
   */
  async function performHistoricalSearch(q: string, releaseId: string): Promise<void> {
    results = [];
    historicalWarning = null;
    if (!historicalManifest) {
      historicalWarning = 'Historical search index is not available; current law is not substituted.';
      loading = false;
      return;
    }

    const relMeta = historicalManifest.availableReleases.find((r) => r.releaseId === releaseId);
    if (!relMeta || relMeta.titlesAvailable.length === 0) {
      historicalWarning = `No historical search shards collected for release ${releaseId}; current law is not substituted.`;
      loading = false;
      return;
    }

    const qTokens = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (qTokens.length === 0) {
      loading = false;
      return;
    }
    const matched: PagefindResultData[] = [];
    const failedShards: string[] = [];

    try {
      for (const title of relMeta.titlesAvailable) {
        const shardKey = `${releaseId}__title-${title}`;
        const shardMeta = historicalManifest.shards[shardKey];
        if (!shardMeta) {
          failedShards.push(`title-${title} (missing manifest entry)`);
          continue;
        }

        let shard = shardCache.get(shardKey);
        if (!shard) {
          const res = await fetch(`${getBaseUrl()}${shardMeta.shardPath}`);
          if (!res.ok) {
            failedShards.push(`title-${title} (HTTP ${res.status})`);
            continue;
          }
          const loadedShard = (await res.json()) as HistoricalSearchShard;
          if (shardMeta.shardDigest && (!loadedShard.shardDigest || shardMeta.shardDigest !== loadedShard.shardDigest)) {
            failedShards.push(`title-${title} (digest mismatch or missing digest)`);
            continue;
          }
          shard = loadedShard;
          shardCache.set(shardKey, shard);
        }

        for (const entry of shard.entries) {
          const hay = `${entry.citation} ${entry.aliases.join(' ')} ${entry.heading} ${entry.excerpt} ${entry.bodyMarkdown ?? ''}`.toLowerCase();
          if (qTokens.every((token) => hay.includes(token))) {
            matched.push({
              url: entry.historicalUrl,
              meta: { title: `${entry.citation} — ${entry.heading} (${relMeta.label})` },
              excerpt: entry.excerpt,
            });
          }
        }
      }

      if (failedShards.length > 0) {
        historicalWarning = `Incomplete historical shards for ${relMeta.label} (${failedShards.join(', ')}); current law is not substituted.`;
      } else if (relMeta.coverageState !== 'complete') {
        historicalWarning = `Historical release ${relMeta.label} coverage is ${relMeta.coverageState}.`;
      }
      results = matched.slice(0, 10);
    } catch {
      historicalWarning = `Failed to load historical search shard for ${releaseId}; current law is not substituted.`;
      results = [];
    } finally {
      loading = false;
    }
  }

  function closeResults(): void {
    setTimeout(() => {
      showResults = false;
      activeIndex = -1;
    }, 200);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      showResults = false;
      activeIndex = -1;
      return;
    }

    if (!showResults || results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = activeIndex < results.length - 1 ? activeIndex + 1 : 0;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = activeIndex > 0 ? activeIndex - 1 : results.length - 1;
    } else if (event.key === 'Enter') {
      if (activeIndex >= 0 && results[activeIndex]) {
        event.preventDefault();
        window.location.href = results[activeIndex].url;
      } else if (citationJump) {
        event.preventDefault();
        window.location.href = citationJumpHref;
      }
    }
  }
</script>

<div class="relative min-w-0 w-full font-sans space-y-1" role="search">
  <label for="search-input" class="sr-only">Search the US Code</label>
  <noscript><p class="text-xs">Search requires JavaScript. <a href={`${getBaseUrl()}browse/`} class="underline">Browse all titles</a>.</p></noscript>
  {#if historicalManifest && historicalManifest.availableReleases.length > 0}
    <div class="flex items-center justify-between gap-1 text-[10px]">
      <label for="search-release-scope" class="text-gray-500 dark:text-gray-400">Scope:</label>
      <select
        id="search-release-scope"
        bind:value={selectedRelease}
        class="min-w-0 max-w-full flex-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
      >
        <option value="current">Current Law</option>
        {#each historicalManifest.availableReleases as rel}
          <option value={rel.releaseId}>{rel.label} ({rel.coverageState})</option>
        {/each}
      </select>
    </div>
  {/if}
  <div class="relative">
    <span class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </span>
    <input
      id="search-input"
      type="search"
      placeholder={devMode && selectedRelease === 'current' ? 'Search available in production build' : 'Search (press /)'}
      disabled={devMode && selectedRelease === 'current'}
      bind:value={query}
      onfocusin={() => { if (query.length > 0) showResults = true; }}
      onfocusout={closeResults}
      onkeydown={handleKeydown}
      role="combobox"
      aria-expanded={showResults}
      aria-controls="search-results"
      aria-activedescendant={activeIndex >= 0 ? `result-${activeIndex}` : undefined}
      aria-autocomplete="list"
      aria-haspopup="listbox"
      class="w-full rounded border border-gray-300 bg-white py-1 pl-8 pr-2 text-xs text-gray-900 placeholder-gray-400 focus:border-teal focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-600"
    />
  </div>

  <!-- Always render the listbox container so aria-controls is always valid when expanded -->
  <ul
    id="search-results"
    role="listbox"
    aria-label="Search results"
    class="absolute left-0 top-full z-50 mt-1 w-full max-w-[calc(100vw-2rem)] overflow-y-auto rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900 {showResults ? 'max-h-80' : 'hidden'}"
  >
    {#if showResults}
      {#if historicalWarning}
        <li role="presentation" class="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          {historicalWarning}
        </li>
      {/if}
      {#if citationJump}
        <li role="presentation" class="border-b border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-850">
          <a
            href={citationJumpHref}
            class="flex items-center justify-between rounded bg-white px-2.5 py-1.5 text-xs font-semibold text-teal shadow-2xs hover:bg-gray-50 dark:bg-gray-800 dark:text-teal-bright dark:hover:bg-gray-700"
          >
            <span class="flex items-center gap-1.5">
              <span class="rounded bg-teal/15 px-1 py-0.5 text-[10px] font-bold text-teal dark:text-teal-bright">
                ⚡ Jump
              </span>
              <span>Go to {citationJump.display}</span>
            </span>
            <span class="text-xs">&rarr;</span>
          </a>
        </li>
      {/if}
      {#if loading}
        <li role="option" aria-selected="false" class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">Searching...</li>
      {:else if results.length === 0 && !citationJump}
        <li role="option" aria-selected="false" class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">No results found.</li>
      {:else}
        {#each results as result, i}
          <li
            role="option"
            id="result-{i}"
            aria-selected={i === activeIndex}
            class="divide-y divide-gray-100 dark:divide-gray-800"
          >
            <a
              href={result.url}
              class="block px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 {i === activeIndex ? 'bg-gray-100 dark:bg-gray-800' : ''}"
            >
              <div class="truncate text-xs font-medium text-gray-900 dark:text-gray-100">
                {result.meta.title ?? 'Untitled'}
              </div>
              <div class="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                {@html sanitizeExcerpt(result.excerpt)}
              </div>
            </a>
          </li>
        {/each}
      {/if}
    {/if}
  </ul>
</div>

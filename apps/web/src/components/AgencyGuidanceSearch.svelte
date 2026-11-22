<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    uscTitle: string | number;
    uscSection: string;
  }

  interface GovSearchResult {
    title: string;
    url: string;
    description?: string;
    domain?: string;
    extractionState?: string;
  }

  interface AgencyGuidanceSnapshotPayload {
    snapshotAsOf?: string;
    coverageState?: string;
    records?: GovSearchResult[];
  }

  let { uscTitle, uscSection }: Props = $props();

  let query = $state(`${uscTitle} U.S.C. ${uscSection}`);
  let loading = $state(true);
  let snapshotAsOf = $state<string | null>(null);
  let coverageState = $state<string>('complete');
  let allRecords = $state<GovSearchResult[]>([]);
  let results = $state<GovSearchResult[]>([]);

  const rawBase = import.meta.env.BASE_URL || '/';
  const baseUrl = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

  function filterRecords(searchQuery: string, source: GovSearchResult[]): GovSearchResult[] {
    const terms = searchQuery
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);
    if (terms.length === 0) return source;
    return source.filter((item) => {
      const hay = `${item.title} ${item.description ?? ''} ${item.domain ?? ''}`.toLowerCase();
      return terms.some((t) => hay.includes(t));
    });
  }

  onMount(async () => {
    try {
      loading = true;
      const response = await fetch(`${baseUrl}context/agency-guidance.json`);
      if (response.ok) {
        const raw: unknown = await response.json();
        if (raw && typeof raw === 'object') {
          const data = raw as AgencyGuidanceSnapshotPayload;
          snapshotAsOf = typeof data.snapshotAsOf === 'string' ? data.snapshotAsOf : null;
          coverageState = typeof data.coverageState === 'string' ? data.coverageState : 'complete';
          allRecords = Array.isArray(data.records) ? data.records : [];
          results = filterRecords(query, allRecords);
        }
      } else {
        coverageState = 'not_collected';
      }
    } catch {
      coverageState = 'not_collected';
    } finally {
      loading = false;
    }
  });

  function handleSearch(e?: Event) {
    if (e) e.preventDefault();
    results = filterRecords(query, allRecords);
  }
</script>

<div class="space-y-3 font-sans text-xs">
  <div class="rounded bg-[var(--surface-raised)] border border-[var(--border-subtle)] p-3">
    <div class="flex items-center justify-between gap-2">
      <span class="font-semibold text-[var(--text-primary)]">Civic & Guidance Explorer</span>
      <span class="rounded bg-navy/10 text-navy dark:bg-amber/15 dark:text-amber text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-wider">
        Static Index ({coverageState})
      </span>
    </div>
    <p class="mt-1 text-[var(--text-muted)] text-[11px]">
      Precomputed agency guidance, manuals, and official publications{snapshotAsOf ? ` (as of ${snapshotAsOf.slice(0, 10)})` : ''} — non-binding candidate context.
    </p>
  </div>

  <form onsubmit={handleSearch} class="flex gap-1.5">
    <input
      type="text"
      bind:value={query}
      placeholder="Filter guidance for {uscTitle} U.S.C. {uscSection}"
      class="flex-1 rounded border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--civic-action)]"
    />
    <button
      type="submit"
      disabled={loading}
      class="rounded bg-[var(--civic-navy)] px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50 cursor-pointer text-xs"
    >
      Filter
    </button>
  </form>

  {#if loading}
    <div class="flex items-center justify-center p-6 text-[var(--text-muted)] gap-2">
      <svg class="h-4 w-4 animate-spin text-[var(--civic-action)]" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
      </svg>
      <span>Loading static guidance index...</span>
    </div>
  {:else if results.length === 0}
    <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 text-center text-[var(--text-muted)] space-y-1">
      <p>No precomputed guidance records matched "{query}".</p>
      <a
        href="https://www.govinfo.gov/app/search/%7B%22query%22%3A%22%5C%22{encodeURIComponent(`${uscTitle} U.S.C. ${uscSection}`)}%5C%22%22%2C%22offset%22%3A0%7D"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-block font-semibold text-[var(--civic-action)] hover:underline mt-1"
      >
        Search GovInfo.gov &rarr;
      </a>
    </div>
  {:else}
    <div class="space-y-2">
      {#each results as res}
        <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 shadow-2xs space-y-1">
          <div class="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
            <span class="font-mono">{res.domain ?? 'govinfo.gov'}</span>
            <span class="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[9px] uppercase font-semibold">
              {res.extractionState ?? 'candidate'}
            </span>
          </div>
          <a
            href={res.url}
            target="_blank"
            rel="noopener noreferrer"
            class="block font-semibold text-[var(--civic-action)] hover:underline leading-snug"
          >
            {res.title}
          </a>
          {#if res.description}
            <p class="text-[11px] text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
              {res.description}
            </p>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

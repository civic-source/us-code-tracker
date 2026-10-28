<script lang="ts">
  interface Props {
    uscTitle: string | number;
    uscSection: string;
  }

  interface GovSearchResult {
    title: string;
    url: string;
    description?: string;
    domain?: string;
  }

  let { uscTitle, uscSection }: Props = $props();

  let query = $state(`${uscTitle} U.S.C. ${uscSection}`);
  let searching = $state(false);
  let searched = $state(false);
  let error = $state<string | null>(null);
  let results = $state<GovSearchResult[]>([]);

  async function handleSearch(e?: Event) {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    try {
      searching = true;
      error = null;
      results = [];

      // Query Firecrawl's free /search/gov index endpoint
      const response = await fetch('https://api.firecrawl.dev/v2/search/gov', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query.trim(),
          limit: 5,
          jurisdiction: 'federal',
        }),
      });

      if (!response.ok) {
        throw new Error(`Firecrawl API responded with HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data && Array.isArray(data.data)) {
        results = data.data.map((item: any) => ({
          title: item.title || item.url,
          url: item.url,
          description: item.description || item.snippet,
          domain: new URL(item.url).hostname.replace(/^www\./, ''),
        }));
      }
    } catch (err: any) {
      error = err.message || 'Error querying Government Index';
    } finally {
      searching = false;
      searched = true;
    }
  }
</script>

<div class="space-y-3 font-sans text-xs">
  <div class="rounded bg-[var(--surface-raised)] border border-[var(--border-subtle)] p-3">
    <div class="flex items-center justify-between">
      <span class="font-semibold text-[var(--text-primary)]">Civic & Guidance Explorer</span>
      <span class="rounded bg-navy/10 text-navy dark:bg-amber/15 dark:text-amber text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-wider">Firecrawl Gov</span>
    </div>
    <p class="mt-1 text-[var(--text-muted)] text-[11px]">
      Search 30M+ government pages for agency guidance, manuals, bulletins, and municipal regulations citing this section.
    </p>
  </div>

  <form onsubmit={handleSearch} class="flex gap-1.5">
    <input
      type="text"
      bind:value={query}
      placeholder="e.g. {uscTitle} U.S.C. {uscSection} EPA guidance"
      class="flex-1 rounded border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--civic-action)]"
    />
    <button
      type="submit"
      disabled={searching}
      class="rounded bg-[var(--civic-navy)] px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50 cursor-pointer text-xs"
    >
      {searching ? 'Searching…' : 'Search'}
    </button>
  </form>

  {#if searching}
    <div class="flex items-center justify-center p-6 text-[var(--text-muted)] gap-2">
      <svg class="h-4 w-4 animate-spin text-[var(--civic-action)]" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
      </svg>
      <span>Searching 30M+ government records...</span>
    </div>
  {:else if error}
    <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 text-[11px] text-[var(--text-secondary)] space-y-1">
      <p class="text-[var(--legal-caution)] font-semibold">Firecrawl Index Direct Query</p>
      <p class="text-[10px] text-[var(--text-muted)]">
        Public client requests may be rate-limited by browser CORS or policy. Explore official government publications on GovInfo:
      </p>
      <a
        href="https://www.govinfo.gov/app/search/%7B%22query%22%3A%22%5C%22{encodeURIComponent(`${uscTitle} U.S.C. ${uscSection}`)}%5C%22%22%2C%22offset%22%3A0%7D"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-block font-semibold text-[var(--civic-action)] hover:underline mt-1"
      >
        Search GovInfo.gov &rarr;
      </a>
    </div>
  {:else if searched && results.length === 0}
    <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 text-center text-[var(--text-muted)]">
      <p>No external guidance records found for this query.</p>
    </div>
  {:else if results.length > 0}
    <div class="space-y-2">
      {#each results as res}
        <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 shadow-2xs space-y-1">
          <div class="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
            <span class="font-mono">{res.domain}</span>
            <span>.gov record</span>
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

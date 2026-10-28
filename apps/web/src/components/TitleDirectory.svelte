<script lang="ts">
  import type { TitleCategory } from '../data/title-categories';

  export interface TitleEntry {
    num: string;
    name: string;
    sectionCount: number;
    pct: number;
    href: string;
    category: TitleCategory;
  }

  interface Props {
    titles: TitleEntry[];
    totalSections: number;
  }

  let { titles, totalSections }: Props = $props();

  let searchQuery = $state('');
  let selectedCategory = $state<string>('All');

  const categories = [
    'All',
    'Administration & Governance',
    'Judiciary & Criminal Law',
    'Commerce, Tax & Finance',
    'Health, Education & Resources',
    'Defense, Security & Foreign Affairs'
  ];

  let filteredTitles = $derived(
    titles.filter((t) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        q === '' ||
        t.num.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q);

      const matchesCat =
        selectedCategory === 'All' || t.category === selectedCategory;

      return matchesSearch && matchesCat;
    })
  );

  let categoryCounts = $derived.by(() => {
    const counts: Record<string, number> = { All: titles.length };
    for (const cat of categories.slice(1)) {
      counts[cat] = titles.filter((t) => t.category === cat).length;
    }
    return counts;
  });
</script>

<div class="not-prose my-6 font-sans">
  <!-- Controls Bar: Search & Category Chips -->
  <div class="mb-6 space-y-4">
    <!-- Live Search Input -->
    <div class="relative max-w-xl">
      <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[var(--text-muted)]">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <input
        type="search"
        bind:value={searchQuery}
        placeholder="Filter by title number or subject (e.g., 18, crimes, tax, patent, armed forces)..."
        class="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] py-2.5 pl-10 pr-10 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] shadow-xs transition-colors focus:border-[var(--civic-action)] focus:outline-none focus:ring-1 focus:ring-[var(--civic-action)]"
        aria-label="Filter United States Code titles"
      />
      {#if searchQuery}
        <button
          type="button"
          onclick={() => { searchQuery = ''; }}
          class="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          aria-label="Clear filter"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      {/if}
    </div>

    <!-- Category Filter Chips -->
    <div class="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Title categories">
      {#each categories as cat}
        <button
          type="button"
          role="tab"
          aria-selected={selectedCategory === cat}
          onclick={() => { selectedCategory = cat; }}
          class={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
            selectedCategory === cat
              ? 'bg-[var(--civic-navy)] text-white shadow-xs'
              : 'border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]'
          }`}
        >
          {cat}
          <span class="ml-1 opacity-70 tabular-nums">({categoryCounts[cat] ?? 0})</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- Results Count Bar -->
  <div class="mb-4 flex items-center justify-between text-xs text-[var(--text-muted)]">
    <span>
      Showing <strong class="text-[var(--text-primary)] tabular-nums">{filteredTitles.length}</strong> of {titles.length} titles
      {#if searchQuery}
        for "<span class="font-medium text-[var(--text-primary)]">{searchQuery}</span>"
      {/if}
    </span>
    <span class="tabular-nums">{totalSections.toLocaleString()} total statutory sections</span>
  </div>

  <!-- Titles Grid / List -->
  {#if filteredTitles.length > 0}
    <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {#each filteredTitles as title (title.num)}
        <a
          href={title.href}
          class="group relative flex flex-col justify-between rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] p-4 shadow-2xs transition-all duration-150 hover:border-[var(--civic-action)] hover:shadow-xs focus:outline-none focus:ring-2 focus:ring-[var(--civic-action)]"
        >
          <div>
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="inline-flex items-center gap-1.5 rounded bg-[var(--surface-sunken)] px-2 py-0.5 font-mono text-xs font-bold text-[var(--civic-navy)] border border-[var(--border-subtle)]">
                Title {title.num}
              </span>
              <span class="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider truncate">
                {title.category.split(' & ')[0]}
              </span>
            </div>
            <h3 class="text-sm font-semibold leading-snug text-[var(--text-primary)] group-hover:text-[var(--civic-action)] transition-colors line-clamp-2">
              {title.name}
            </h3>
          </div>

          <div class="mt-4 pt-3 border-t border-[var(--border-subtle)]">
            <div class="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1.5">
              <span>{title.sectionCount.toLocaleString()} sections</span>
              <span class="font-medium text-[var(--civic-action)] group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-0.5">
                Browse &rarr;
              </span>
            </div>
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
              <div
                class="h-full rounded-full bg-[var(--legal-action)]/80 transition-all"
                style={`width: ${Math.max(title.pct, 3)}%`}
              ></div>
            </div>
          </div>
        </a>
      {/each}
    </div>
  {:else}
    <div class="rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--surface-sunken)] p-8 text-center">
      <svg class="mx-auto h-8 w-8 text-[var(--text-muted)] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="text-sm font-semibold text-[var(--text-primary)]">No matching titles found</p>
      <p class="mt-1 text-xs text-[var(--text-muted)]">No titles match your query "{searchQuery}" under "{selectedCategory}".</p>
      <button
        type="button"
        onclick={() => { searchQuery = ''; selectedCategory = 'All'; }}
        class="mt-4 inline-flex items-center rounded-md bg-[var(--civic-navy)] px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[var(--civic-navy-dark)]"
      >
        Reset filters
      </button>
    </div>
  {/if}
</div>

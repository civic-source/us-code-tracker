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
  let viewMode = $state<'grid' | 'table'>('grid');

  $effect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('title-directory-view');
      if (saved === 'grid' || saved === 'table') viewMode = saved;
    } catch {
      // Storage access blocked or restricted
    }
  });

  function setViewMode(mode: 'grid' | 'table'): void {
    viewMode = mode;
    try {
      localStorage.setItem('title-directory-view', mode);
    } catch {
      // Storage access blocked or restricted
    }
  }

  const categories = [
    'All',
    'Administration & Governance',
    'Judiciary & Criminal Law',
    'Commerce, Tax & Finance',
    'Health, Education & Resources',
    'Defense, Security & Foreign Affairs',
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
  <!-- Controls Bar: Search & Category Chips & View Mode Toggle -->
  <div class="mb-6 space-y-4">
    <!-- Top row: Live Search + View Mode Switcher -->
    <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
      <!-- Live Search Input -->
      <div class="relative flex-1 max-w-xl">
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
            class="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            aria-label="Clear filter"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        {/if}
      </div>

      <!-- View Mode Switcher (Grid vs High-Density Table) -->
      <div class="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] p-0.5 shadow-2xs self-start sm:self-auto" role="group" aria-label="Layout view mode">
        <button
          type="button"
          onclick={() => setViewMode('grid')}
          class={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            viewMode === 'grid'
              ? 'bg-[var(--civic-navy)] text-white shadow-xs'
              : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]'
          }`}
          aria-pressed={viewMode === 'grid'}
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
          <span>Cards</span>
        </button>
        <button
          type="button"
          onclick={() => setViewMode('table')}
          class={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            viewMode === 'table'
              ? 'bg-[var(--civic-navy)] text-white shadow-xs'
              : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]'
          }`}
          aria-pressed={viewMode === 'table'}
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          <span>Table</span>
        </button>
      </div>
    </div>

    <!-- Category Filter Chips -->
    <div class="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Title categories">
      {#each categories as cat}
        <button
          type="button"
          role="tab"
          aria-selected={selectedCategory === cat}
          onclick={() => { selectedCategory = cat; }}
          class={`rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
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
    <span class="tabular-nums font-mono">{totalSections.toLocaleString()} total statutory sections</span>
  </div>

  <!-- Titles View: Grid or High-Density Table -->
  {#if filteredTitles.length > 0}
    {#if viewMode === 'grid'}
      <!-- Wide Desktop Grid: 1 col mobile, 2 sm, 3 lg, 4 on 2xl screens -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {#each filteredTitles as title (title.num)}
          <a
            href={title.href}
            class="group relative flex flex-col justify-between rounded-xl border border-[var(--border-default)] bg-[var(--surface-raised)] p-5 shadow-2xs transition-all duration-150 hover:border-[var(--civic-action)] hover:shadow-xs focus:outline-none focus:ring-2 focus:ring-[var(--civic-action)]"
          >
            <div>
              <div class="flex items-center justify-between gap-2 mb-2">
                <span class="inline-flex items-center gap-1.5 rounded bg-[var(--surface-sunken)] px-2.5 py-0.5 font-mono text-xs font-bold text-[var(--civic-navy)] border border-[var(--border-subtle)]">
                  Title {title.num}
                </span>
                <span class="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider truncate max-w-[130px]">
                  {title.category.split(' & ')[0]}
                </span>
              </div>
              <h3 class="text-sm font-bold leading-snug text-[var(--text-primary)] group-hover:text-[var(--civic-action)] transition-colors line-clamp-2">
                {title.name}
              </h3>
            </div>

            <div class="mt-5 pt-3 border-t border-[var(--border-subtle)]">
              <div class="flex items-center justify-between text-xs text-[var(--text-muted)] mb-2">
                <span class="font-mono font-medium">{title.sectionCount.toLocaleString()} sections</span>
                <span class="font-semibold text-[var(--civic-action)] group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-0.5 text-xs">
                  <span>Browse</span>
                  <span>&rarr;</span>
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
      <!-- High-Density Desktop Table View -->
      <div class="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-raised)] shadow-2xs">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[var(--text-muted)] font-semibold uppercase tracking-wider text-[11px]">
                <th scope="col" class="py-3 px-4 w-24">Title #</th>
                <th scope="col" class="py-3 px-4">Subject Name</th>
                <th scope="col" class="py-3 px-4 w-56 hidden md:table-cell">Civic Domain</th>
                <th scope="col" class="py-3 px-4 w-36 text-right">Sections</th>
                <th scope="col" class="py-3 px-4 w-44 hidden lg:table-cell">Relative Depth</th>
                <th scope="col" class="py-3 px-4 w-28 text-right">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[var(--border-subtle)]">
              {#each filteredTitles as title (title.num)}
                <tr class="transition-colors hover:bg-[var(--surface-sunken)] group">
                  <td class="py-3 px-4 font-mono font-bold text-[var(--civic-navy)] whitespace-nowrap">
                    Title {title.num}
                  </td>
                  <td class="py-3 px-4 font-semibold text-[var(--text-primary)] group-hover:text-[var(--civic-action)] transition-colors">
                    <a href={title.href} class="hover:underline">
                      {title.name}
                    </a>
                  </td>
                  <td class="py-3 px-4 text-[var(--text-muted)] text-[11px] hidden md:table-cell whitespace-nowrap">
                    {title.category}
                  </td>
                  <td class="py-3 px-4 text-right font-mono font-medium text-[var(--text-primary)] tabular-nums whitespace-nowrap">
                    {title.sectionCount.toLocaleString()} §
                  </td>
                  <td class="py-3 px-4 hidden lg:table-cell">
                    <div class="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                      <div
                        class="h-full rounded-full bg-[var(--legal-action)]/80"
                        style={`width: ${Math.max(title.pct, 3)}%`}
                      ></div>
                    </div>
                  </td>
                  <td class="py-3 px-4 text-right whitespace-nowrap">
                    <a
                      href={title.href}
                      class="inline-flex items-center gap-1 font-semibold text-[var(--civic-action)] hover:underline"
                    >
                      <span>Explore</span>
                      <span>&rarr;</span>
                    </a>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  {:else}
    <div class="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface-sunken)] p-12 text-center">
      <svg class="mx-auto h-10 w-10 text-[var(--text-muted)] mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="text-base font-bold text-[var(--text-primary)]">No matching statutory titles</p>
      <p class="mt-1 text-xs text-[var(--text-muted)]">No titles match "{searchQuery}" in "{selectedCategory}".</p>
      <button
        type="button"
        onclick={() => { searchQuery = ''; selectedCategory = 'All'; }}
        class="mt-4 inline-flex items-center rounded-lg bg-[var(--civic-navy)] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[var(--civic-navy-dark)] cursor-pointer"
      >
        Reset filters
      </button>
    </div>
  {/if}
</div>

<script lang="ts">
  import type { CaseAnnotation } from '../lib/types';
  import FederalRegisterActivity from './FederalRegisterActivity.svelte';
  import AgencyGuidanceSearch from './AgencyGuidanceSearch.svelte';

  interface Props {
    sectionId: string;
    uscTitle: string | number;
    uscSection: string;
    annotations?: CaseAnnotation[];
  }

  let { sectionId, uscTitle, uscSection, annotations = [] }: Props = $props();

  type TabId = 'precedents' | 'regulations' | 'rulemaking' | 'guidance';
  let activeTab = $state<TabId>('precedents');
  let open = $state(false); // Mobile drawer toggle
  let expandedHoldings = $state<Set<number>>(new Set());

  // Check if any precedent is invalidating or narrowing
  const hasInvalidation = $derived(
    annotations.some(c => c.impact === 'unconstitutional')
  );
  const hasNarrowing = $derived(
    annotations.some(c => c.impact === 'narrowed')
  );

  const COURT_ORDER: CaseAnnotation['court'][] = ['SCOTUS', 'Appellate', 'District'];

  function grouped(): Map<CaseAnnotation['court'], CaseAnnotation[]> {
    const map = new Map<CaseAnnotation['court'], CaseAnnotation[]>();
    for (const court of COURT_ORDER) {
      const cases = annotations.filter((a) => a.court === court);
      if (cases.length > 0) map.set(court, cases);
    }
    return map;
  }

  function toggleHolding(idx: number): void {
    const next = new Set(expandedHoldings);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    expandedHoldings = next;
  }
</script>

<!-- Mobile Floating Trigger -->
<div class="fixed right-0 top-1/2 z-40 -translate-y-1/2 xl:hidden">
  <button
    onclick={() => (open = !open)}
    class="flex items-center gap-1.5 rounded-l-md bg-[var(--civic-navy)] px-2.5 py-3 text-xs font-semibold text-white shadow-lg hover:opacity-90 transition-opacity cursor-pointer"
    aria-label={open ? 'Close inspector' : 'Open inspector'}
    aria-expanded={open}
  >
    {#if hasInvalidation}
      <span class="inline-block h-2 w-2 rounded-full bg-[var(--legal-invalid)] animate-pulse" title="Warning: Constitutional Challenge/Holding"></span>
    {/if}
    <span>{open ? '›' : '‹'} Inspector</span>
  </button>
</div>

<!-- Inspector Container: Sidebar on XL+, Overlay Drawer below XL -->
<aside
  class:list={[
    'font-sans transition-all z-30',
    // Mobile Drawer styling
    open
      ? 'fixed inset-y-0 right-0 w-full sm:w-[420px] bg-[var(--surface-raised)] border-l border-[var(--border-default)] shadow-2xl p-5 overflow-y-auto block xl:static xl:w-80 2xl:w-96 xl:p-0 xl:shadow-none xl:border-l xl:border-[var(--border-subtle)] xl:bg-[var(--surface-sunken)]'
      : 'hidden xl:block xl:w-80 2xl:w-96 xl:border-l xl:border-[var(--border-subtle)] xl:bg-[var(--surface-sunken)]'
  ]}
  aria-label="Statutory Authority & Precedent Inspector"
>
  <div class="sticky top-0 z-10 bg-[var(--surface-raised)] xl:bg-[var(--surface-sunken)] border-b border-[var(--border-subtle)] p-3">
    <!-- Header with Pinpoint Title and Close on Mobile -->
    <div class="flex items-center justify-between pb-2">
      <div class="flex items-center gap-1.5">
        <span class="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Authority Inspector</span>
        <span class="font-mono text-xs font-semibold text-[var(--text-primary)]">§ {uscSection}</span>
      </div>
      {#if open}
        <button
          onclick={() => (open = false)}
          class="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] xl:hidden cursor-pointer"
          aria-label="Close inspector"
        >✕</button>
      {/if}
    </div>

    <!-- Tab Navigation -->
    <nav class="flex gap-1 overflow-x-auto text-xs" aria-label="Inspector tabs">
      <button
        onclick={() => (activeTab = 'precedents')}
        class:list={[
          'px-2.5 py-1.5 rounded font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap',
          activeTab === 'precedents'
            ? 'bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-2xs font-semibold'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        ]}
      >
        <span>Precedents</span>
        {#if annotations.length > 0}
          <span class="rounded-full bg-[var(--border-subtle)] px-1.5 py-0.2 text-[10px]">{annotations.length}</span>
        {/if}
      </button>

      <button
        onclick={() => (activeTab = 'regulations')}
        class:list={[
          'px-2.5 py-1.5 rounded font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap',
          activeTab === 'regulations'
            ? 'bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-2xs font-semibold'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        ]}
      >
        <span>CFR Rules</span>
        <span class="rounded-full bg-[var(--legal-valid-bg)] text-[var(--legal-valid)] px-1.5 py-0.2 text-[9px] font-bold">eCFR</span>
      </button>

      <button
        onclick={() => (activeTab = 'rulemaking')}
        class:list={[
          'px-2.5 py-1.5 rounded font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap',
          activeTab === 'rulemaking'
            ? 'bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-2xs font-semibold'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        ]}
      >
        <span>Federal Register</span>
      </button>

      <button
        onclick={() => (activeTab = 'guidance')}
        class:list={[
          'px-2.5 py-1.5 rounded font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap',
          activeTab === 'guidance'
            ? 'bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-2xs font-semibold'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        ]}
      >
        <span>Guidance</span>
        <span class="rounded-full bg-navy/10 text-navy dark:bg-amber/15 dark:text-amber px-1.5 py-0.2 text-[9px] font-bold">Gov</span>
      </button>
    </nav>
  </div>

  <!-- Tab Content Panel -->
  <div class="p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-140px)]">
    <!-- TAB 1: PRECEDENTS & SHEPARD'S TREATMENT -->
    {#if activeTab === 'precedents'}
      {#if hasInvalidation}
        <div class="rounded-md border border-[var(--legal-invalid)] bg-[var(--legal-invalid-bg)] p-3 text-xs">
          <div class="flex items-center gap-1.5 font-bold text-[var(--legal-invalid)]">
            <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
            <span>Constitutional Warning</span>
          </div>
          <p class="mt-1 text-[var(--text-primary)]">
            Provisions of this section have been held unconstitutional or enjoined in one or more judicial decisions below.
          </p>
        </div>
      {:else if hasNarrowing}
        <div class="rounded-md border border-[var(--legal-caution)] bg-[var(--legal-caution-bg)] p-3 text-xs">
          <div class="flex items-center gap-1.5 font-bold text-[var(--legal-caution)]">
            <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
            <span>Narrowing Precedent</span>
          </div>
          <p class="mt-1 text-[var(--text-primary)]">
            Judicial precedent has narrowed or limited the statutory scope of this section.
          </p>
        </div>
      {/if}

      {#if annotations.length === 0}
        <div class="text-center py-8 text-xs text-[var(--text-muted)]">
          <p>No precedent annotations on file for § {uscSection}.</p>
          <a
            href="https://www.courtlistener.com/?q={encodeURIComponent(`${uscTitle} U.S.C. ${uscSection}`)}"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-2 inline-block text-[var(--civic-action)] underline hover:opacity-80"
          >
            Search CourtListener &rarr;
          </a>
        </div>
      {:else}
        {#each [...grouped()] as [court, cases]}
          <div>
            <h4 class="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {court} ({cases.length})
            </h4>
            <div class="space-y-2.5">
              {#each cases as c}
                {@const globalIdx = annotations.indexOf(c)}
                <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 text-xs shadow-2xs">
                  <div class="flex items-start justify-between gap-2">
                    <a
                      href={c.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="font-semibold text-[var(--civic-action)] hover:underline leading-snug"
                    >
                      {c.caseName}
                    </a>
                    {#if c.impact === 'unconstitutional'}
                      <span class="rounded bg-[var(--legal-invalid-bg)] text-[var(--legal-invalid)] px-1.5 py-0.5 text-[9px] font-bold uppercase">Struck Down</span>
                    {:else if c.impact === 'narrowed'}
                      <span class="rounded bg-[var(--legal-caution-bg)] text-[var(--legal-caution)] px-1.5 py-0.5 text-[9px] font-bold uppercase">Narrowed</span>
                    {/if}
                  </div>
                  <div class="mt-1 text-[11px] text-[var(--text-muted)]">
                    <span>{c.citation}</span> · <span>{c.date}</span>
                  </div>

                  {#if c.holdingSummary}
                    <div class="mt-2 pt-2 border-t border-[var(--border-subtle)]">
                      <p class="text-[var(--text-secondary)] leading-relaxed">
                        {expandedHoldings.has(globalIdx) ? c.holdingSummary : c.holdingSummary.slice(0, 140) + (c.holdingSummary.length > 140 ? '…' : '')}
                      </p>
                      {#if c.holdingSummary.length > 140}
                        <button
                          onclick={() => toggleHolding(globalIdx)}
                          class="mt-1 text-[10px] font-medium text-[var(--civic-action)] hover:underline cursor-pointer"
                        >
                          {expandedHoldings.has(globalIdx) ? 'Show less' : 'Read full holding'}
                        </button>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      {/if}

    <!-- TAB 2: IMPLEMENTING REGULATIONS (eCFR PTOA) -->
    {:else if activeTab === 'regulations'}
      <div class="space-y-3">
        <div class="rounded bg-[var(--surface-raised)] border border-[var(--border-subtle)] p-3 text-xs">
          <div class="font-semibold text-[var(--text-primary)]">Parallel Table of Authorities (PTOA)</div>
          <p class="mt-1 text-[var(--text-muted)] text-[11px]">
            Administrative agencies derive regulatory authority directly from acts of Congress codified here.
          </p>
        </div>

        <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 text-xs shadow-2xs space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-bold text-[var(--text-primary)]">Federal Agency Rules</span>
            <span class="text-[10px] text-[var(--text-muted)]">Official eCFR</span>
          </div>
          <p class="text-[var(--text-secondary)]">
            Explore regulations codified under the authority of {uscTitle} U.S.C. § {uscSection}.
          </p>
          <a
            href="https://www.ecfr.gov/search?query={encodeURIComponent(`${uscTitle} U.S.C. ${uscSection}`)}&search_type=authority"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-[var(--civic-action)] font-medium hover:underline text-xs"
          >
            <span>Search eCFR Authority Table</span>
            <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
      </div>

    <!-- TAB 3: LIVE FEDERAL REGISTER ACTIVITY -->
    {:else if activeTab === 'rulemaking'}
      <FederalRegisterActivity {uscTitle} {uscSection} />

    <!-- TAB 4: FIRECRAWL GOV GUIDANCE EXPLORER -->
    {:else if activeTab === 'guidance'}
      <AgencyGuidanceSearch {uscTitle} {uscSection} />
    {/if}
  </div>
</aside>

<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    uscTitle: string | number;
    uscSection: string;
    cfrTitle?: number;
    cfrPart?: number;
  }

  interface FederalRegisterDoc {
    title: string;
    type: string;
    action?: string;
    agency_names: string[];
    publication_date: string;
    comments_close_on?: string;
    html_url: string;
    citation: string;
  }

  let { uscTitle, uscSection, cfrTitle, cfrPart }: Props = $props();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let documents = $state<FederalRegisterDoc[]>([]);

  onMount(async () => {
    try {
      loading = true;
      error = null;

      // Construct open Federal Register API query
      // If CFR title/part is known, query by CFR condition; otherwise query citation text
      const params = new URLSearchParams();
      if (cfrTitle && cfrPart) {
        params.append('conditions[cfr][title]', String(cfrTitle));
        params.append('conditions[cfr][part]', String(cfrPart));
      } else {
        params.append('conditions[term]', `${uscTitle} U.S.C. ${uscSection}`);
      }
      params.append('conditions[type][]', 'RULE');
      params.append('conditions[type][]', 'PRORULE');
      params.append('conditions[type][]', 'NOTICE');
      params.append('order', 'newest');
      params.append('per_page', '5');

      const url = `https://www.federalregister.gov/api/v1/documents.json?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data && Array.isArray(data.results)) {
        documents = data.results.map((item: any) => ({
          title: item.title,
          type: item.type,
          action: item.action,
          agency_names: item.agency_names ?? [],
          publication_date: item.publication_date,
          comments_close_on: item.comments_close_on,
          html_url: item.html_url,
          citation: item.citation,
        }));
      }
    } catch (e: any) {
      error = e.message ?? 'Failed to load Federal Register data';
    } finally {
      loading = false;
    }
  });

  function isCommentPeriodOpen(dateStr?: string): boolean {
    if (!dateStr) return false;
    const deadline = new Date(dateStr);
    return deadline.getTime() >= Date.now();
  }
</script>

<div class="space-y-3 font-sans text-xs">
  <div class="rounded bg-[var(--surface-raised)] border border-[var(--border-subtle)] p-3">
    <div class="flex items-center justify-between">
      <span class="font-semibold text-[var(--text-primary)]">Federal Register Actions</span>
      <span class="rounded bg-teal/15 text-teal text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-wider">Live API</span>
    </div>
    <p class="mt-1 text-[var(--text-muted)] text-[11px]">
      Recent proposed rules, final regulations, and public comment dockets.
    </p>
  </div>

  {#if loading}
    <div class="flex items-center justify-center p-6 text-[var(--text-muted)] gap-2">
      <svg class="h-4 w-4 animate-spin text-[var(--civic-action)]" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
      </svg>
      <span>Checking Federal Register...</span>
    </div>
  {:else if error}
    <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 text-[11px] text-[var(--text-secondary)]">
      <p>Could not load real-time notices ({error}).</p>
      <a
        href="https://www.federalregister.gov/documents/search?conditions%5Bterm%5D={encodeURIComponent(`${uscTitle} U.S.C. ${uscSection}`)}"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-2 inline-block font-semibold text-[var(--civic-action)] hover:underline"
      >
        Search on FederalRegister.gov &rarr;
      </a>
    </div>
  {:else if documents.length === 0}
    <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 text-center text-[var(--text-muted)]">
      <p>No recent rulemaking notices found for § {uscSection}.</p>
      <a
        href="https://www.federalregister.gov/documents/search?conditions%5Bterm%5D={encodeURIComponent(`${uscTitle} U.S.C. ${uscSection}`)}"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-2 inline-block font-semibold text-[var(--civic-action)] hover:underline"
      >
        Search all years on Federal Register &rarr;
      </a>
    </div>
  {:else}
    <div class="space-y-2">
      {#each documents as doc}
        <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 shadow-2xs space-y-1.5">
          <div class="flex items-start justify-between gap-1.5">
            <span class:list={[
              'rounded px-1.5 py-0.5 text-[9px] font-bold uppercase shrink-0',
              doc.type === 'Proposed Rule' ? 'bg-[var(--legal-caution-bg)] text-[var(--legal-caution)]' :
              doc.type === 'Rule' ? 'bg-[var(--legal-valid-bg)] text-[var(--legal-valid)]' :
              'bg-[var(--surface-sunken)] text-[var(--text-muted)]'
            ]}>
              {doc.type}
            </span>
            <span class="text-[10px] text-[var(--text-muted)] shrink-0">{doc.publication_date}</span>
          </div>

          <a
            href={doc.html_url}
            target="_blank"
            rel="noopener noreferrer"
            class="block font-medium text-[var(--civic-action)] hover:underline leading-snug"
          >
            {doc.title}
          </a>

          {#if doc.agency_names.length > 0}
            <div class="text-[10px] text-[var(--text-muted)] truncate">
              Agency: {doc.agency_names.join(', ')}
            </div>
          {/if}

          {#if doc.comments_close_on}
            <div class="mt-1 flex items-center gap-1 text-[10px]">
              {#if isCommentPeriodOpen(doc.comments_close_on)}
                <span class="inline-block h-1.5 w-1.5 rounded-full bg-[var(--legal-valid)] animate-pulse"></span>
                <span class="font-semibold text-[var(--legal-valid)]">Comments open until {doc.comments_close_on}</span>
              {:else}
                <span class="text-[var(--text-muted)]">Comments closed {doc.comments_close_on}</span>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

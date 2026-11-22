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

  interface FederalRegisterSnapshotPayload {
    snapshotAsOf?: string;
    coverageState?: string;
    sections?: Record<string, FederalRegisterDoc[]>;
  }

  let { uscTitle, uscSection }: Props = $props();

  let loading = $state(true);
  let snapshotAsOf = $state<string | null>(null);
  let coverageState = $state<string>('complete');
  let documents = $state<FederalRegisterDoc[]>([]);

  const rawBase = import.meta.env.BASE_URL || '/';
  const baseUrl = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

  onMount(async () => {
    try {
      loading = true;
      const key = `${uscTitle}/${uscSection}`;
      const response = await fetch(`${baseUrl}context/federal-register.json`);
      if (response.ok) {
        const raw: unknown = await response.json();
        if (raw && typeof raw === 'object') {
          const data = raw as FederalRegisterSnapshotPayload;
          snapshotAsOf = typeof data.snapshotAsOf === 'string' ? data.snapshotAsOf : null;
          coverageState = typeof data.coverageState === 'string' ? data.coverageState : 'complete';
          const sectionDocs = data.sections?.[key];
          if (Array.isArray(sectionDocs)) {
            documents = sectionDocs;
          }
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

  function isCommentPeriodOpen(dateStr?: string): boolean {
    if (!dateStr) return false;
    const deadline = new Date(dateStr);
    return deadline.getTime() >= Date.now();
  }
</script>

<div class="space-y-3 font-sans text-xs">
  <div class="rounded bg-[var(--surface-raised)] border border-[var(--border-subtle)] p-3">
    <div class="flex items-center justify-between gap-2">
      <span class="font-semibold text-[var(--text-primary)]">Federal Register Actions</span>
      <span class="rounded bg-teal/15 text-teal text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-wider">
        Static Snapshot ({coverageState})
      </span>
    </div>
    <p class="mt-1 text-[var(--text-muted)] text-[11px]">
      Precomputed rulemaking notices, proposed rules, and comment dockets{snapshotAsOf ? ` (as of ${snapshotAsOf.slice(0, 10)})` : ''}.
    </p>
  </div>

  {#if loading}
    <div class="flex items-center justify-center p-6 text-[var(--text-muted)] gap-2">
      <svg class="h-4 w-4 animate-spin text-[var(--civic-action)]" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
      </svg>
      <span>Loading precomputed Federal Register snapshot...</span>
    </div>
  {:else if documents.length === 0}
    <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 text-center text-[var(--text-muted)]">
      <p>No precomputed rulemaking notices in the current snapshot for {uscTitle} U.S.C. § {uscSection}.</p>
      <a
        href="https://www.federalregister.gov/documents/search?conditions%5Bterm%5D={encodeURIComponent(`${uscTitle} U.S.C. ${uscSection}`)}"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-2 inline-block font-semibold text-[var(--civic-action)] hover:underline"
      >
        Search all years on FederalRegister.gov &rarr;
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

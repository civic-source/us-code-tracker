<script lang="ts">
  import type { CaseAnnotation } from '../lib/types';
  import type { ImplementingRegulation, SourceRefreshMeta } from '@civic-source/types';
  import FederalRegisterActivity from './FederalRegisterActivity.svelte';
  import AgencyGuidanceSearch from './AgencyGuidanceSearch.svelte';

  interface Props {
    sectionId: string;
    uscTitle: string | number;
    uscSection: string;
    annotations?: CaseAnnotation[];
    annotationRefreshStatus?: SourceRefreshMeta;
    regulations?: ImplementingRegulation[];
    regulationRefreshStatus?: SourceRefreshMeta;
  }

  let {
    sectionId,
    uscTitle,
    uscSection,
    annotations = [],
    annotationRefreshStatus,
    regulations = [],
    regulationRefreshStatus,
  }: Props = $props();

  type TabId = 'precedents' | 'regulations' | 'relationships' | 'rulemaking' | 'guidance';
  let activeTab = $state<TabId>('precedents');
  let open = $state(false); // Mobile drawer toggle
  let expandedHoldings = $state<Set<number>>(new Set());

  interface RelationshipEdge {
    assertionId: string;
    direction: 'outbound' | 'inbound';
    relationType: string;
    peerId: string;
    peerLabel: string;
    authorityKind: string;
    extractionState: string;
    editorialReview: string;
    versionAlignmentState: string;
    propositionText?: string;
    evidenceExcerpts: string[];
  }

  interface RelationshipShard {
    schemaVersion: 'usct.relationship-neighborhood/v1';
    provisionId: string;
    citation: string;
    releaseId: string;
    edges: RelationshipEdge[];
  }

  let relationshipShard = $state<RelationshipShard | null>(null);
  let relationshipsLoading = $state(false);
  let relationshipsError = $state<string | null>(null);
  let relationshipsLoadedFor = $state<string | null>(null);

  function getInspectorBaseUrl(): string {
    if (typeof document !== 'undefined') {
      const meta = document.querySelector('meta[name="base-url"]')?.getAttribute('content');
      if (meta) return meta.endsWith('/') ? meta : `${meta}/`;
    }
    const envBase = import.meta.env.BASE_URL || '/us-code-tracker/';
    return envBase.endsWith('/') ? envBase : `${envBase}/`;
  }

  async function loadRelationships(): Promise<void> {
    if (typeof window === 'undefined') return;
    const urlRelease = new URLSearchParams(window.location.search).get('release')?.trim() || 'pl-119-73';
    const key = `${urlRelease}/${uscTitle}-${uscSection}`;
    if (relationshipsLoadedFor === key) return;
    relationshipsLoadedFor = key;
    relationshipsLoading = true;
    relationshipsError = null;
    try {
      const res = await fetch(`${getInspectorBaseUrl()}neighborhoods/${key}.json`);
      if (!res.ok) {
        relationshipShard = null;
        relationshipsError = `No static relationship neighborhood shard available for ${uscTitle} U.S.C. § ${uscSection} in ${urlRelease}.`;
        return;
      }
      relationshipShard = (await res.json()) as RelationshipShard;
    } catch {
      relationshipShard = null;
      relationshipsError = `Relationship shard unavailable for ${uscTitle} U.S.C. § ${uscSection}.`;
    } finally {
      relationshipsLoading = false;
    }
  }

  $effect(() => {
    if (activeTab === 'relationships') {
      void loadRelationships();
    }
  });

  function isVerifiedHolding(c: CaseAnnotation): boolean {
    return (
      c.extractionState === 'verified' &&
      c.editorialReview === 'accepted' &&
      typeof c.reviewedProposition === 'string' &&
      c.reviewedProposition.trim().length > 0
    );
  }

  function isVerifiedRegulation(r: ImplementingRegulation): boolean {
    return (
      r.extractionState === 'verified' &&
      (r.relationshipType === 'authority_citation' || r.relationshipType === 'implements_verified') &&
      typeof r.verifiedAuthorityText === 'string' &&
      r.verifiedAuthorityText.trim().length > 0
    );
  }

  // Only trigger constitutional or narrowing banner when backed by a verified, accepted proposition (USCT-004)
  const hasInvalidation = $derived(
    annotations.some(c => isVerifiedHolding(c) && c.impact === 'unconstitutional')
  );
  const hasNarrowing = $derived(
    annotations.some(c => isVerifiedHolding(c) && c.impact === 'narrowed')
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

<!-- Inspector Container: Card widget on XL+, Overlay Drawer below XL -->
<aside
  class:list={[
    'font-sans transition-all z-30',
    // Mobile Drawer vs Desktop Docked Rail
    open
      ? 'fixed inset-y-0 right-0 w-full sm:w-[420px] bg-[var(--surface-raised)] border-l border-[var(--border-default)] shadow-2xl p-5 overflow-y-auto block xl:static xl:w-80 2xl:w-96 xl:p-0 xl:shadow-2xs xl:border xl:border-[var(--border-default)] xl:rounded-xl xl:bg-[var(--surface-raised)]'
      : 'hidden xl:block xl:w-80 2xl:w-96 xl:border xl:border-[var(--border-default)] xl:rounded-xl xl:bg-[var(--surface-raised)] shadow-2xs overflow-hidden sticky top-6 self-start shrink-0'
  ]}
  aria-label="Statutory Authority & Precedent Inspector"
>
  <div class="sticky top-0 z-10 bg-[var(--surface-sunken)] border-b border-[var(--border-subtle)] p-3">
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
        onclick={() => (activeTab = 'relationships')}
        class:list={[
          'px-2.5 py-1.5 rounded font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap',
          activeTab === 'relationships'
            ? 'bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-2xs font-semibold'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        ]}
      >
        <span>Relationships</span>
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
    <!-- TAB 1: PRECEDENTS & RETRIEVAL EVIDENCE (USCT-002 & USCT-004) -->
    {#if activeTab === 'precedents'}
      {#if annotationRefreshStatus && (annotationRefreshStatus.isStale || annotationRefreshStatus.status === 'failed' || annotationRefreshStatus.status === 'partial')}
        <div class="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-800 dark:text-amber-300" role="status">
          <div class="font-bold">
            Source Status: {annotationRefreshStatus.status === 'failed' ? 'Source Outage (Retained Last Snapshot)' : 'Partial / Stale Snapshot'}
          </div>
          <p class="mt-0.5 text-[10px]">
            {annotationRefreshStatus.errorMessage ?? 'Showing last validated judicial citation snapshot.'}
            {#if annotationRefreshStatus.lastSuccessAt}
              <span> (Last synced: {annotationRefreshStatus.lastSuccessAt.slice(0, 10)})</span>
            {/if}
          </p>
        </div>
      {/if}

      {#if hasInvalidation}
        <div class="rounded-md border border-[var(--legal-invalid)] bg-[var(--legal-invalid-bg)] p-3 text-xs">
          <div class="flex items-center gap-1.5 font-bold text-[var(--legal-invalid)]">
            <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
            <span>Verified Constitutional Holding</span>
          </div>
          <p class="mt-1 text-[var(--text-primary)]">
            Provisions of this section have a verified judicial holding of unconstitutionality or injunction below.
          </p>
        </div>
      {:else if hasNarrowing}
        <div class="rounded-md border border-[var(--legal-caution)] bg-[var(--legal-caution-bg)] p-3 text-xs">
          <div class="flex items-center gap-1.5 font-bold text-[var(--legal-caution)]">
            <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
            <span>Verified Narrowing Precedent</span>
          </div>
          <p class="mt-1 text-[var(--text-primary)]">
            Reviewed judicial precedent has narrowed or limited the statutory scope of this section.
          </p>
        </div>
      {/if}

      {#if annotations.length === 0}
        <div class="text-center py-8 text-xs text-[var(--text-muted)]">
          {#if annotationRefreshStatus?.status === 'failed'}
            <p class="font-semibold text-amber-700 dark:text-amber-400">CourtListener source temporarily unavailable.</p>
            <p class="mt-1 text-[11px]">An upstream outage is not a zero-case determination.</p>
          {:else}
            <p>No judicial citation records on file for § {uscSection}.</p>
          {/if}
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
                {@const verified = isVerifiedHolding(c)}
                {@const displayExcerpt = verified ? (c.reviewedProposition ?? c.holdingSummary) : (c.retrievalExcerpt ?? c.holdingSummary)}
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
                    {#if verified}
                      <span class="rounded bg-[var(--legal-valid-bg)] text-[var(--legal-valid)] px-1.5 py-0.5 text-[9px] font-bold uppercase shrink-0">
                        Reviewed Proposition
                      </span>
                    {:else}
                      <span class="rounded bg-[var(--surface-sunken)] text-[var(--text-muted)] px-1.5 py-0.5 text-[9px] font-semibold uppercase shrink-0" title="Automated full-text search hit from CourtListener; not a verified judicial holding">
                        Retrieval Excerpt
                      </span>
                    {/if}
                  </div>
                  <div class="mt-1 text-[11px] text-[var(--text-muted)]">
                    <span>{c.citation}</span> · <span>{c.date}</span>
                    {#if c.statuteVersionRef}
                      · <span class="font-mono text-[10px]">Version: {c.statuteVersionRef}</span>
                    {:else}
                      · <span class="text-[10px] italic">Version alignment unverified</span>
                    {/if}
                  </div>

                  {#if displayExcerpt}
                    <div class="mt-2 pt-2 border-t border-[var(--border-subtle)]">
                      <div class="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">
                        {verified ? 'Reviewed Legal Proposition' : 'Search Retrieval Excerpt (Unreviewed)'}
                      </div>
                      <p class="text-[var(--text-secondary)] leading-relaxed">
                        {expandedHoldings.has(globalIdx) ? displayExcerpt : displayExcerpt.slice(0, 140) + (displayExcerpt.length > 140 ? '…' : '')}
                      </p>
                      {#if displayExcerpt.length > 140}
                        <button
                          onclick={() => toggleHolding(globalIdx)}
                          class="mt-1 text-[10px] font-medium text-[var(--civic-action)] hover:underline cursor-pointer"
                        >
                          {expandedHoldings.has(globalIdx) ? 'Show less' : (verified ? 'Read full proposition' : 'Read full retrieval excerpt')}
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

    <!-- TAB 2: eCFR CANDIDATES & VERIFIED AUTHORITY (USCT-002 & USCT-003) -->
    {:else if activeTab === 'regulations'}
      <div class="space-y-3">
        {#if regulationRefreshStatus && (regulationRefreshStatus.isStale || regulationRefreshStatus.status === 'failed' || regulationRefreshStatus.status === 'partial')}
          <div class="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-800 dark:text-amber-300" role="status">
            <div class="font-bold">
              eCFR Status: {regulationRefreshStatus.status === 'failed' ? 'Source Outage (Retained Last Snapshot)' : 'Partial / Stale Snapshot'}
            </div>
            <p class="mt-0.5 text-[10px]">
              {regulationRefreshStatus.errorMessage ?? 'Showing last saved eCFR regulatory records.'}
            </p>
          </div>
        {/if}

        <div class="rounded bg-[var(--surface-raised)] border border-[var(--border-subtle)] p-3 text-xs">
          <div class="font-semibold text-[var(--text-primary)]">CFR Regulatory Candidates &amp; Authority</div>
          <p class="mt-1 text-[var(--text-muted)] text-[11px]">
            Distinguishes unverified eCFR full-text search candidates from CFR parts with verified statutory authority citations.
          </p>
        </div>

        {#if regulations.length > 0}
          <div class="space-y-2">
            {#each regulations as reg}
              {@const verifiedAuth = isVerifiedRegulation(reg)}
              <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 text-xs shadow-2xs space-y-1.5">
                <div class="flex items-start justify-between gap-2">
                  <a
                    href={reg.ecfrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="font-bold text-[var(--civic-action)] hover:underline"
                  >
                    {reg.cfrTitle} CFR Part {reg.cfrPart}
                  </a>
                  {#if verifiedAuth}
                    <span class="rounded bg-[var(--legal-valid-bg)] text-[var(--legal-valid)] px-1.5 py-0.5 text-[9px] font-bold uppercase shrink-0">
                      Verified Authority
                    </span>
                  {:else}
                    <span class="rounded bg-amber-500/15 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 text-[9px] font-semibold uppercase shrink-0">
                      Unverified Candidate
                    </span>
                  {/if}
                </div>
                <div class="text-[11px] font-medium text-[var(--text-primary)]">{reg.agency}</div>
                {#if reg.description}
                  <div class="text-[11px] text-[var(--text-secondary)]">{reg.description}</div>
                {/if}
                {#if verifiedAuth && reg.verifiedAuthorityText}
                  <div class="mt-1 rounded bg-[var(--surface-sunken)] p-2 text-[10px] font-mono text-[var(--text-secondary)]">
                    {reg.verifiedAuthorityText}
                  </div>
                {:else}
                  <div class="mt-1 rounded bg-[var(--surface-sunken)] p-2 text-[10px] text-[var(--text-muted)]">
                    <div><strong>Discovery:</strong> eCFR text search ({reg.discoveryQuery ?? `"${uscTitle} U.S.C. ${uscSection}"`})</div>
                    {#if reg.matchingEvidence}
                      <div class="mt-0.5 truncate">{reg.matchingEvidence}</div>
                    {/if}
                    <div class="mt-0.5 italic">Authority relationship not yet verified against PTOA.</div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 text-xs shadow-2xs space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-bold text-[var(--text-primary)]">Official eCFR Authority Lookup</span>
            <span class="text-[10px] text-[var(--text-muted)]">eCFR.gov</span>
          </div>
          <p class="text-[var(--text-secondary)]">
            Inspect full text and authority citations referencing {uscTitle} U.S.C. § {uscSection}.
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

    <!-- TAB 3: STATIC RELATIONSHIP NEIGHBORHOOD EXPLORER (USCT-021) -->
    {:else if activeTab === 'relationships'}
      <div class="space-y-3" data-relationships-panel>
        <div class="rounded bg-[var(--surface-raised)] border border-[var(--border-subtle)] p-3 text-xs">
          <div class="font-semibold text-[var(--text-primary)]">Version-Scoped Legal Relationships</div>
          <p class="mt-1 text-[var(--text-muted)] text-[11px]">
            Static neighborhood graph linking statutes, enacted Public Laws, CFR authorities, and reviewed opinions.
          </p>
        </div>

        {#if relationshipsLoading}
          <div class="p-4 text-center text-xs text-[var(--text-muted)]">Loading relationship shard...</div>
        {:else if relationshipsError}
          <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 text-center text-xs text-[var(--text-muted)]">
            {relationshipsError}
          </div>
        {:else if relationshipShard && relationshipShard.edges.length > 0}
          <div class="text-[10px] font-mono text-[var(--text-muted)]">
            Release: {relationshipShard.releaseId} · Provision: {relationshipShard.provisionId} · {relationshipShard.edges.length} edges
          </div>
          <div class="space-y-2">
            {#each relationshipShard.edges as edge (edge.assertionId)}
              <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 text-xs space-y-1.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-mono text-[10px] uppercase font-bold text-[var(--civic-action)]">
                    {edge.direction === 'outbound' ? '→' : '←'} {edge.relationType}
                  </span>
                  <span class:list={[
                    'rounded px-1.5 py-0.5 text-[9px] font-bold uppercase',
                    edge.extractionState === 'verified' && edge.editorialReview === 'accepted'
                      ? 'bg-[var(--legal-valid-bg)] text-[var(--legal-valid)]'
                      : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                  ]}>
                    {edge.extractionState}/{edge.editorialReview}
                  </span>
                </div>
                <div class="font-semibold text-[var(--text-primary)]">{edge.peerLabel}</div>
                <div class="text-[10px] text-[var(--text-muted)]">
                  Kind: {edge.authorityKind} · Alignment: {edge.versionAlignmentState}
                </div>
                {#if edge.propositionText}
                  <p class="text-[11px] text-[var(--text-secondary)] leading-relaxed">{edge.propositionText}</p>
                {/if}
                {#if edge.evidenceExcerpts.length > 0}
                  <div class="rounded bg-[var(--surface-sunken)] p-2 text-[10px] text-[var(--text-muted)] font-mono">
                    {edge.evidenceExcerpts[0]}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <div class="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 text-center text-xs text-[var(--text-muted)]">
            No asserted relationship edges recorded for this section in this release.
          </div>
        {/if}
      </div>

    <!-- TAB 4: LIVE FEDERAL REGISTER ACTIVITY -->
    {:else if activeTab === 'rulemaking'}
      <FederalRegisterActivity {uscTitle} {uscSection} />

    <!-- TAB 4: FIRECRAWL GOV GUIDANCE EXPLORER -->
    {:else if activeTab === 'guidance'}
      <AgencyGuidanceSearch {uscTitle} {uscSection} />
    {/if}
  </div>

  <!-- Primary Legal Authorities Footer -->
  <div class="border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3 text-xs">
    <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
      External Primary Authorities
    </div>
    <div class="grid grid-cols-2 gap-1.5 text-[11px]">
      <a
        href="https://www.govinfo.gov/link/uscode/{uscTitle}/{uscSection}"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-1.5 text-[var(--text-primary)] hover:border-[var(--civic-action)] transition-colors"
        title="Official Authenticated GPO PDF"
      >
        <span class="font-semibold text-[var(--civic-action)]">GPO GovInfo</span>
        <span class="text-[9px] text-[var(--text-muted)] ml-auto">PDF &rarr;</span>
      </a>
      <a
        href="https://www.law.cornell.edu/uscode/text/{uscTitle}/{uscSection}"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-1.5 text-[var(--text-primary)] hover:border-[var(--civic-action)] transition-colors"
        title="Cornell Law School Legal Information Institute"
      >
        <span class="font-semibold text-[var(--civic-action)]">Cornell LII</span>
        <span class="text-[9px] text-[var(--text-muted)] ml-auto">&rarr;</span>
      </a>
    </div>
  </div>
</aside>

<script lang="ts">
  import { onMount } from 'svelte';
  import { retainedCitation } from '../lib/published-citation';
  import { isAcceptedCurrentRelease } from '../lib/accepted-release-context';

  interface Props {
    uscTitle: string | number;
    uscSection: string;
    currentRelease: string;
    acceptedDataTag?: string;
  }

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
    sourceGaps?: Array<{ releaseId: string; uscTitle: string; uscSection: string; reason: string; replacementPath?: string }>;
    availableReleases: HistoricalReleaseMeta[];
    shards: Record<string, { shardPath: string; shardDigest: string; entryCount: number }>;
  }

  interface HistoricalSearchShardEntry {
    provisionId: string;
    provisionVersionId: string;
    releaseId: string;
    uscTitle: string;
    uscChapter?: string;
    uscSection: string;
    citation: string;
    aliases: string[];
    heading: string;
    status?: string;
    excerpt: string;
    bodyMarkdown?: string;
    sourceCredits?: string[];
    notes?: Array<{
      noteId: string;
      role?: string;
      heading?: string;
      text: string;
      locator?: string;
    }>;
    tables?: Array<{
      tableId: string;
      caption?: string;
      headers: string[];
      rows: string[][];
      locator?: string;
    }>;
    legacyDerived?: boolean;
    historicalUrl: string;
    publisherReleaseId?: string;
    sourceQualification?: { releaseId: string; sectionIdentifier: string };
    subsectionAnchorIds?: string[];
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

  let { uscTitle, uscSection, currentRelease, acceptedDataTag = '' }: Props = $props();

  let requestedRelease = $state<string | null>(null);
  let loading = $state(false);
  let releaseLabel = $state<string | null>(null);
  let coverageState = $state<string>('not_collected');
  let historicalEntry = $state<HistoricalSearchShardEntry | null>(null);
  let sourceReplacementUrl = $state<string | null>(null);
  let historicalSourceUrl = $state<string | null>(null);
  let unavailableReason = $state<string | null>(null);

  function getBaseUrl(): string {
    if (typeof document !== 'undefined') {
      const meta = document.querySelector('meta[name="base-url"]')?.getAttribute('content');
      if (meta) return meta.endsWith('/') ? meta : `${meta}/`;
    }
    const envBase = import.meta.env.BASE_URL || '/us-code-tracker/';
    return envBase.endsWith('/') ? envBase : `${envBase}/`;
  }

  function preserveReleaseInNav(releaseId: string): void {
    if (typeof document === 'undefined') return;
    const navLinks = document.querySelectorAll('#statute-section-nav a, nav[aria-label="Chapter sections"] a');
    for (const el of navLinks) {
      if (!(el instanceof HTMLAnchorElement)) continue;
      try {
        const u = new URL(el.href, window.location.origin);
        u.searchParams.set('release', releaseId);
        el.href = u.pathname + u.search + u.hash;
      } catch {
        // Ignore non-URL anchors
      }
    }
  }

  function hideCurrentBody(hide: boolean): void {
    if (typeof document === 'undefined') return;
    const currentEl = document.getElementById('current-statute-body');
    if (currentEl) {
      currentEl.style.display = hide ? 'none' : '';
    }
  }

  onMount(async () => {
    if (typeof window === 'undefined') return;
    const param = new URLSearchParams(window.location.search).get('release');
    if (!param || !param.trim()) return;

    const cleanParam = param.trim();
    if (isAcceptedCurrentRelease(cleanParam, acceptedDataTag || currentRelease)) {
      return;
    }

    requestedRelease = cleanParam;
    loading = true;
    // Never leave current-release statutory text visible as a silent fallback when a historical release is requested
    hideCurrentBody(true);

    const base = getBaseUrl();
    const titleStr = String(uscTitle);
    const secStr = String(uscSection);

    try {
      const manRes = await fetch(`${base}search-shards/manifest.json`);
      if (!manRes.ok) {
        unavailableReason = `Historical shard manifest is unavailable (HTTP ${manRes.status}). Current law is hidden to prevent false historical attribution.`;
        return;
      }
      const manifest = (await manRes.json()) as HistoricalSearchIndexManifest;
      const relMeta = manifest.availableReleases.find((r) => r.releaseId === cleanParam);
      const sourceGap = manifest.sourceGaps?.find((gap) => gap.releaseId === cleanParam &&
        gap.uscTitle === titleStr && gap.uscSection === secStr);
      if (sourceGap) {
        if (sourceGap.replacementPath === `history/${cleanParam}/${titleStr}/${secStr}/`) sourceReplacementUrl = base + sourceGap.replacementPath;
        unavailableReason = `${sourceGap.reason} This withdrawn record is unavailable in the retained collection; current text is hidden.`;
        return;
      }
      if (!relMeta) {
        unavailableReason = `Historical release "${cleanParam}" is not in the published historical index. Current law is hidden to prevent substituting modern text.`;
        return;
      }

      releaseLabel = relMeta.label;
      coverageState = relMeta.coverageState;
      const shardKey = `${cleanParam}__title-${titleStr}`;
      const shardMeta = manifest.shards[shardKey];
      if (!shardMeta) {
        unavailableReason = `Title ${titleStr} was not collected in release ${relMeta.label} (${cleanParam}). Current law is hidden to prevent substituting modern text.`;
        return;
      }

      const shardRes = await fetch(`${base}${shardMeta.shardPath}`);
      if (!shardRes.ok) {
        unavailableReason = `Historical shard for ${relMeta.label} Title ${titleStr} could not be loaded (HTTP ${shardRes.status}).`;
        return;
      }
      const shard = (await shardRes.json()) as HistoricalSearchShard;
      if (shardMeta.shardDigest && (!shard.shardDigest || shardMeta.shardDigest !== shard.shardDigest)) {
        unavailableReason = `Historical shard digest mismatch or missing digest for ${relMeta.label} Title ${titleStr}; refusing to display unverified snapshot.`;
        return;
      }

      const match = shard.entries.find(
        (e) => String(e.uscTitle) === titleStr && String(e.uscSection) === secStr
      );
      if (!match) {
        unavailableReason = `${titleStr} U.S.C. § ${secStr} is not present in the collected ${relMeta.label} (${cleanParam}) snapshot scope.`;
        return;
      }

      if (match.sourceQualification) {
        const resolved = retainedCitation([match], cleanParam, { display: match.citation, title: titleStr, section: secStr }, base);
        if (!resolved.ok) { unavailableReason = resolved.error.message; return; }
        historicalSourceUrl = resolved.value;
      }
      historicalEntry = match;
      preserveReleaseInNav(cleanParam);
    } catch (e: unknown) {
      unavailableReason = `Error loading historical release ${cleanParam}: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      loading = false;
    }
  });
</script>

<noscript>
  <section data-edition-query-unavailable aria-label="Edition selection without JavaScript" class="not-prose mb-4 rounded border border-amber-600 p-3 text-sm">
    <p>This page's static text uses publisher release {currentRelease}; accepted data tag: {acceptedDataTag || 'not supplied'}.</p>
    <p>Query parameters do not select another edition without JavaScript. Another or unknown requested edition is unavailable in this view; the text below is not a substitute for it.</p>
    <a href="https://uscode.house.gov/download.html">Consult the official source editions</a>
  </section>
</noscript>

{#if requestedRelease}
  <section
    data-historical-release-viewer
    data-release-id={requestedRelease}
    class="not-prose mb-6 space-y-4"
    aria-live="polite"
  >
    {#if loading}
      <div class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 font-sans text-sm text-amber-900 dark:text-amber-200" role="status">
        Loading historical statutory snapshot for release <code class="font-mono font-bold">{requestedRelease}</code>...
      </div>
    {:else if unavailableReason}
      <div class="rounded-xl border border-red-500/40 bg-red-500/10 p-5 font-sans text-sm text-red-900 dark:text-red-200 space-y-2" role="alert">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="font-bold uppercase tracking-wider text-xs">
            Historical Snapshot Unavailable ({requestedRelease})
          </span>
          <a
            href={typeof window !== 'undefined' ? window.location.pathname : './'}
            class="rounded bg-[var(--civic-navy)] px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
          >
            Return to Current Law ({currentRelease})
          </a>
        </div>
        <p>{unavailableReason}</p>
        {#if sourceReplacementUrl}<p><a href={sourceReplacementUrl} class="underline font-semibold">Open the separately retained source-checked edition</a></p>{/if}
      </div>
    {:else if historicalEntry}
      <div class="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 font-sans text-xs text-amber-950 dark:text-amber-100 space-y-2" role="status">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              Historical Snapshot: {releaseLabel ?? requestedRelease}
            </span>
            <span class="font-mono text-[11px]">Version ID: {historicalEntry.provisionVersionId}</span>
            <span class="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)] border border-[var(--border-subtle)]">
              {historicalEntry.sourceQualification ? 'Independently checked OLRC snapshot' : historicalEntry.legacyDerived ? 'Legacy-Derived Git Blob' : 'Unqualified record'}
            </span>
            <span class="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)] border border-[var(--border-subtle)]">
              Scope Coverage: {coverageState}
            </span>
          </div>
          <a
            href={typeof window !== 'undefined' ? window.location.pathname : './'}
            class="rounded bg-[var(--civic-navy)] px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
          >
            View Current Law ({currentRelease}) &rarr;
          </a>
        </div>
        <p class="text-[11px]">
          Selected historical record: <strong>{historicalEntry.citation}</strong> in <strong>{releaseLabel ?? requestedRelease}</strong> ({historicalEntry.releaseId}), not current codified law.
        </p>
      </div>

      <div class="rounded-xl border border-[var(--border-default)] bg-[var(--surface-raised)] p-6 font-serif space-y-4">
        <h1 class="text-xl font-bold text-[var(--text-primary)] border-t-2 border-amber-500 pt-3">
          {historicalEntry.heading}
        </h1>

        {#if historicalSourceUrl}
          <p><a href={historicalSourceUrl} class="underline font-semibold">Read the complete source-checked edition, including source credits and editorial notes</a></p>
          <p>This retained static page works without JavaScript. The qualification covers this provision, not the complete title or legal applicability.</p>
        {:else if historicalEntry.bodyMarkdown}
          {@const mdLines = historicalEntry.bodyMarkdown.split('\n')}
          {@const firstSectionIdx = mdLines.findIndex((line) => line.trim().startsWith('## '))}
          {@const bodySlice = firstSectionIdx >= 0 ? mdLines.slice(0, firstSectionIdx) : mdLines}
          <div class="space-y-2 text-[var(--text-primary)] text-base leading-relaxed">
            {#each bodySlice.filter((line) => line.trim().length > 0 && !line.trim().startsWith('# ') && !line.trim().startsWith('|')) as line}
              <p class={line.startsWith('  ') ? 'pl-6 text-[15px]' : line.trim().startsWith('- ') ? 'pl-3' : ''}>
                {line.replace(/^\s*-\s+/, '').replace(/\*\*/g, '')}
              </p>
            {/each}
          </div>
        {:else}
          <p class="text-base leading-relaxed text-[var(--text-primary)]">{historicalEntry.excerpt}</p>
        {/if}

        {#if !historicalSourceUrl && historicalEntry.tables && historicalEntry.tables.length > 0}
          {#each historicalEntry.tables as tbl}
            <div class="overflow-x-auto font-sans text-xs border border-[var(--border-subtle)] rounded-lg p-3 bg-[var(--surface-sunken)]">
              {#if tbl.caption}
                <div class="font-bold mb-2 text-[var(--text-primary)]">{tbl.caption}</div>
              {/if}
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b border-[var(--border-default)]">
                    {#each tbl.headers as hdr}
                      <th class="py-1.5 pr-4 font-semibold">{hdr}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each tbl.rows as row}
                    <tr class="border-b border-[var(--border-subtle)]">
                      {#each row as cell}
                        <td class="py-1.5 pr-4">{cell}</td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/each}
        {/if}

        {#if !historicalSourceUrl && historicalEntry.notes && historicalEntry.notes.length > 0}
          <div class="border-t border-[var(--border-subtle)] pt-3 font-sans text-xs space-y-1.5">
            <div class="font-bold uppercase tracking-wider text-[10px] text-[var(--text-muted)]">Historical Statutory Notes</div>
            {#each historicalEntry.notes as note}
              <div class="rounded bg-[var(--surface-sunken)] p-2 text-[var(--text-secondary)]">
                {#if note.heading}<strong class="text-[var(--text-primary)]">{note.heading}: </strong>{/if}
                <span>{note.text}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </section>
{/if}

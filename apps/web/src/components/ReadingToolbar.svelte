<script lang="ts">
  let fontMode = $state<'serif' | 'sans'>('serif');
  let textSize = $state<'sm' | 'base' | 'lg'>('base');
  let measureMode = $state<'standard' | 'wide'>('standard');

  $effect(() => {
    if (typeof window === 'undefined') return;
    try {
      const storedFont = localStorage.getItem('reading-font');
      if (storedFont === 'sans' || storedFont === 'serif') fontMode = storedFont;

      const storedSize = localStorage.getItem('reading-size');
      if (storedSize === 'sm' || storedSize === 'base' || storedSize === 'lg') textSize = storedSize;

      const storedMeasure = localStorage.getItem('reading-measure');
      if (storedMeasure === 'standard' || storedMeasure === 'wide') measureMode = storedMeasure;
    } catch {
      // Storage access blocked or restricted
    }

    applyClasses();
  });

  function applyClasses() {
    if (typeof document === 'undefined') return;
    const article =
      document.querySelector('article.prose') ||
      document.querySelector('.prose-statute') ||
      document.querySelector('.prose');
    if (!article) return;

    // Font family
    article.classList.toggle('font-reading-serif', fontMode === 'serif');
    article.classList.toggle('font-reading-sans', fontMode === 'sans');

    // Font size
    article.classList.toggle('text-scale-sm', textSize === 'sm');
    article.classList.toggle('text-scale-base', textSize === 'base');
    article.classList.toggle('text-scale-lg', textSize === 'lg');

    // Measure
    article.classList.toggle('measure-standard', measureMode === 'standard');
    article.classList.toggle('measure-wide', measureMode === 'wide');
  }

  function setFont(mode: 'serif' | 'sans') {
    fontMode = mode;
    try {
      localStorage.setItem('reading-font', mode);
    } catch {
      // Storage access blocked or restricted
    }
    applyClasses();
  }

  function cycleSize() {
    if (textSize === 'sm') textSize = 'base';
    else if (textSize === 'base') textSize = 'lg';
    else textSize = 'sm';
    try {
      localStorage.setItem('reading-size', textSize);
    } catch {
      // Storage access blocked or restricted
    }
    applyClasses();
  }

  function toggleMeasure() {
    measureMode = measureMode === 'standard' ? 'wide' : 'standard';
    try {
      localStorage.setItem('reading-measure', measureMode);
    } catch {
      // Storage access blocked or restricted
    }
    applyClasses();
  }
</script>

<div
  role="toolbar"
  aria-label="Reader customization controls"
  class="not-prose mb-6 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--border-default)] py-2 font-sans text-xs"
>
  <!-- Reading Preferences -->
  <div class="flex flex-wrap items-center gap-2">
    <!-- Font family switcher -->
    <div class="inline-flex rounded-md border border-[var(--border-default)] bg-[var(--surface-raised)] p-0.5 shadow-2xs" role="radiogroup" aria-label="Font typeface">
      <button
        onclick={() => setFont('serif')}
        class="rounded px-2 py-0.5 text-xs font-serif transition-colors {fontMode === 'serif' ? 'bg-[var(--civic-navy)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]'}"
        aria-checked={fontMode === 'serif'}
        role="radio"
      >
        Serif
      </button>
      <button
        onclick={() => setFont('sans')}
        class="rounded px-2 py-0.5 text-xs font-sans transition-colors {fontMode === 'sans' ? 'bg-[var(--civic-navy)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]'}"
        aria-checked={fontMode === 'sans'}
        role="radio"
      >
        Sans
      </button>
    </div>

    <!-- Font size cycler -->
    <button
      onclick={cycleSize}
      title="Toggle font size (17px / 19px / 21px)"
      class="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] shadow-2xs hover:bg-[var(--surface-sunken)]"
      aria-label="Toggle text size"
    >
      <span class="text-[11px] text-[var(--text-muted)]">Size:</span>
      <span class="font-bold text-[var(--text-primary)]">{textSize === 'sm' ? '17px' : textSize === 'base' ? '19px' : '21px'}</span>
    </button>

    <!-- Reading measure width toggle -->
    <button
      onclick={toggleMeasure}
      title="Toggle reading line width: Standard (72ch) vs Wide (92ch)"
      class="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] shadow-2xs hover:bg-[var(--surface-sunken)]"
      aria-label="Toggle reading line width"
    >
      <span class="text-[11px] text-[var(--text-muted)]">Width:</span>
      <span class="text-[var(--text-primary)]">{measureMode === 'standard' ? 'Standard' : 'Wide'}</span>
    </button>
  </div>

  <!-- Quick jump links -->
  <div class="flex items-center gap-2">
    <a
      href="#diff-viewer"
      class="inline-flex items-center gap-1 rounded bg-[var(--civic-action)]/10 px-2 py-0.5 text-xs font-medium text-[var(--civic-action)] hover:bg-[var(--civic-action)]/20 transition-colors"
    >
      <span>&Delta; Version History</span>
    </a>
  </div>
</div>

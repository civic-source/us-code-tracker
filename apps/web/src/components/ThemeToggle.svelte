<script lang="ts">
  type Theme = 'light' | 'dark' | 'system';

  let theme = $state<Theme>('system');

  const labels: Record<Theme, string> = {
    light: 'Light',
    dark: 'Dark',
    system: 'System',
  };

  const icons: Record<Theme, string> = {
    light: '\u2600',   // sun
    dark: '\uD83C\uDF19',    // moon
    system: '\uD83D\uDCBB',  // computer
  };

  const order: Theme[] = ['light', 'dark', 'system'];

  function applyTheme(t: Theme): void {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = t === 'dark' || (t === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', isDark);
  }

  function cycle(): void {
    const idx = order.indexOf(theme);
    theme = order[(idx + 1) % order.length];
    localStorage.setItem('theme', theme);
    applyTheme(theme);
  }

  // Initialize from localStorage on mount
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('theme') as Theme | null;
    if (stored && order.includes(stored)) {
      theme = stored;
    }
    applyTheme(theme);
  }
</script>

<button
  onclick={cycle}
  aria-label={`Toggle theme: ${labels[theme]}`}
  title="Theme: {labels[theme]}"
  class="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs font-sans transition-colors hover:bg-gray-200 dark:border-gray-700 dark:hover:bg-gray-800"
>
  <span aria-hidden="true">{icons[theme]}</span>
  <span class="hidden sm:inline">{labels[theme]}</span>
</button>

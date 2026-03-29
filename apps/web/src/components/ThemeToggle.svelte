<script lang="ts">
  let isDark = $state(false);

  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark') {
      isDark = true;
    } else if (stored === 'light') {
      isDark = false;
    } else {
      // Default to system preference
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    document.documentElement.classList.toggle('dark', isDark);
  }

  function toggle(): void {
    isDark = !isDark;
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }
</script>

<button
  onclick={toggle}
  aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
  class="inline-flex items-center gap-1.5 rounded border border-gray-300 px-2.5 py-1.5 text-xs font-sans transition-colors hover:bg-gray-200 dark:border-gray-700 dark:hover:bg-gray-800"
>
  <span aria-hidden="true">{isDark ? '🌙' : '☀️'}</span>
  <span>{isDark ? 'Dark' : 'Light'}</span>
</button>

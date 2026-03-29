<script lang="ts">
  let visible = $state(false);

  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', () => {
      visible = window.scrollY > 400;
    }, { passive: true });
  }

  function scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

{#if visible}
  <button
    onclick={scrollToTop}
    aria-label="Back to top"
    class="fixed bottom-6 right-6 z-40 rounded-full bg-navy p-3 text-white shadow-lg transition-opacity hover:bg-teal focus:outline-none focus:ring-2 focus:ring-teal dark:bg-gray-800 dark:hover:bg-teal"
  >
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  </button>
{/if}

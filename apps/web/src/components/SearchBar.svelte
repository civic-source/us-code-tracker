<script lang="ts">
  let query = $state('');

  function handleSubmit(e: SubmitEvent): void {
    e.preventDefault();
    // Pagefind integration will be wired after build.
    // For now this is a placeholder.
    console.log('Search query:', query);
  }
</script>

<form onsubmit={handleSubmit} class="flex items-center gap-1 font-sans" role="search">
  <label for="search-input" class="sr-only">Search the US Code</label>
  <div class="relative">
    <span class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </span>
    <input
      id="search-input"
      type="search"
      placeholder="Search..."
      bind:value={query}
      class="w-full rounded border border-gray-300 bg-white py-1 pl-8 pr-2 text-xs text-gray-900 placeholder-gray-400 focus:border-teal focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-600 lg:w-48"
    />
  </div>
</form>

<script lang="ts">
  interface Props {
    sectionId: string;
  }

  let { sectionId }: Props = $props();
</script>

<div class="rounded border border-gray-200 bg-gray-50 px-4 py-3 font-sans text-sm text-slate dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
  <p>Precedent annotations for section <code class="font-mono">{sectionId}</code> coming soon.</p>
  <p class="mt-1 text-xs">
    Will display case law references from sidecar YAML annotations.
  </p>
</div>

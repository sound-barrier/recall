<script setup lang="ts">
// Rendered by the lazy-chunk factories (App.vue's lazyView, the
// AppOverlays modals) when a dynamic import fails — a network drop,
// or a redeploy that invalidated the old hashed chunk filenames. A
// full reload fetches the fresh manifest; losing view state is
// acceptable at this failure boundary, a blank pane is not.
function reload() {
  window.location.reload()
}
</script>

<template>
  <div class="view-load-error" data-view-error role="alert">
    <p class="vle-title">
      This part of Recall failed to load.
    </p>
    <p class="vle-detail">
      Check your connection — or the app may have updated underneath
      this session. Reloading fetches the current version.
    </p>
    <button type="button" class="btn-mono is-lg is-accent vle-reload" @click="reload">
      Reload Recall
    </button>
  </div>
</template>

<style scoped>
.view-load-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-12) auto;
  max-width: 32rem;
  padding: var(--space-6) var(--space-6);
  border: 1px solid var(--loss);
  border-radius: var(--radius-surface);
  background: var(--loss-soft);
  text-align: center;
}

.vle-title {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--type-md);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--loss);
}

.vle-detail {
  margin: 0;
  font-size: var(--type-lg);
  color: var(--text-faint);
}

.vle-reload {
  margin-top: var(--space-1);
}
</style>

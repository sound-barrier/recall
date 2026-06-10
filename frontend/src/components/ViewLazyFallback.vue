<script setup lang="ts">
// Loading fallback for lazy view chunks. Shown while a
// `defineAsyncComponent(() => import('./views/...'))` chunk
// downloads on first tab switch — typically <100ms on LAN/local,
// but 200-500ms on throttled 3G. The 220ms `delay` on the async
// component options blocks render until the threshold so fast
// chunk fetches don't flash this fallback.
//
// Visual: a centered mono "Loading view…" line with a 3-dot
// pulse. Same vocabulary as ParseProgressPanel + ParseStatusBar
// so the user reads it as "Recall is doing something" rather
// than "Recall is stuck."
</script>

<template>
  <div class="view-lazy-fallback" role="status" aria-live="polite">
    <span class="view-lazy-label">Loading view</span>
    <span class="view-lazy-dots" aria-hidden="true">
      <span class="view-lazy-dot" />
      <span class="view-lazy-dot" />
      <span class="view-lazy-dot" />
    </span>
  </div>
</template>

<style scoped>
.view-lazy-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.7rem;
  min-height: 50vh;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.view-lazy-dots {
  display: inline-flex;
  gap: 0.32rem;
}

.view-lazy-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-faint);
  animation: view-lazy-pulse 1.1s ease-in-out infinite;
}

.view-lazy-dot:nth-child(2) { animation-delay: 0.18s; }
.view-lazy-dot:nth-child(3) { animation-delay: 0.36s; }

@keyframes view-lazy-pulse {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
  40%           { opacity: 1;    transform: scale(1.1); }
}

@media (prefers-reduced-motion: reduce) {
  .view-lazy-dot { animation: none; opacity: 0.5; }
}
</style>

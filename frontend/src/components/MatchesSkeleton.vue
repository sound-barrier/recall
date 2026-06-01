<script setup lang="ts">
// First-paint placeholder for the Matches view. Mirrors the .leaf-row
// 8-column grid so the layout doesn't shift when real records replace
// the skeleton rows. Shimmer is a single shared keyframe — disabled
// under prefers-reduced-motion via the scoped media query.

withDefaults(defineProps<{
  rows?: number
}>(), { rows: 6 })
</script>

<template>
  <section class="leaves-skeleton" aria-label="Loading matches" data-matches-loading="true">
    <header class="lsk-head" aria-hidden="true">
      <span class="lsk-shimmer lsk-eyebrow" />
      <span class="lsk-shimmer lsk-title" />
    </header>
    <ul class="lsk-list" role="list" aria-busy="true">
      <li
        v-for="i in rows"
        :key="i"
        class="leaf-skeleton"
        aria-hidden="true"
      >
        <span class="lsk-shimmer lsk-checkbox" />
        <span class="lsk-shimmer lsk-strip" />
        <span class="lsk-shimmer lsk-when" />
        <span class="lsk-shimmer lsk-map" />
        <span class="lsk-shimmer lsk-hero" />
        <span class="lsk-shimmer lsk-stats" />
        <span class="lsk-shimmer lsk-meta" />
        <span class="lsk-shimmer lsk-result" />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.leaves-skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 0;
}

.lsk-head {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0 0.25rem 0.5rem;
}

.lsk-eyebrow { width: 6rem; height: 0.65rem; }
.lsk-title   { width: 14rem; height: 1.1rem; }

.lsk-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Match .leaf-row's 8-column grid so the layout never jumps when real
   rows replace the skeleton. Padding + height also mirror so the
   scrollable region size stays stable. */
.leaf-skeleton {
  display: grid;
  grid-template-columns:
    1.1rem
    4px
    72px
    minmax(0, 1.4fr)
    minmax(0, 1fr)
    7rem
    minmax(0, 1fr)
    6rem;
  gap: 0.85rem;
  align-items: center;
  padding: 0.55rem 0.85rem;
  border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  background: var(--surface);
  border-radius: 2px;
  min-height: 3rem;
}

.lsk-checkbox { width: 1rem;   height: 1rem;   border-radius: 2px; }
.lsk-strip    { width: 4px;    height: 28px;   border-radius: 2px; }
.lsk-when     { width: 64px;   height: 1.5rem; }
.lsk-map      { width: 80%;    height: 1.4rem; }
.lsk-hero     { width: 70%;    height: 1.2rem; }
.lsk-stats    { width: 5.5rem; height: 1.4rem; }
.lsk-meta     { width: 60%;    height: 1rem;   }
.lsk-result   { width: 5.5rem; height: 1.4rem; border-radius: 2px; }

.lsk-shimmer {
  display: block;
  background: linear-gradient(
    90deg,
    var(--surface-2) 0%,
    color-mix(in srgb, var(--surface-3) 70%, var(--accent-soft) 30%) 50%,
    var(--surface-2) 100%
  );
  background-size: 200% 100%;
  border-radius: 2px;
  animation: leaf-skeleton-shimmer 1.4s linear infinite;
}

@keyframes leaf-skeleton-shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .lsk-shimmer { animation: none; }
}
</style>

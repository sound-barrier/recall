<script setup lang="ts">
import type { WidgetShape } from '../dashboard/widgets'

// Wrapper chrome for a customizable dashboard widget. The wrapper owns
// the root element + the data-widget-id attribute so MatchesView's
// grid template doesn't have to know each widget's tag/class — it just
// passes `shape` and the wrapper picks the right chrome.
//
// `shape` is the widget's intrinsic visual footprint (compact .kpi-tile
// vs wider .breakdown article). It is NOT the same as which row the
// widget renders in — Phase 3 will let users drag widgets across rows
// regardless of shape. The type is sourced from the registry so a new
// shape value adds to one enum, not two.
//
// `editMode` lands in Phase 3 (drag handle + reorder). Declared now
// as a forward-compatible no-op so consumers can already pass it
// without breaking Phase 1.
//
// `legacyDataKpi` / `legacyDataBreakdown` keep the pre-refactor e2e
// selectors (`[data-kpi="reviewed-count"]`, `[data-breakdown="roles"]`)
// matching. Populated from the registry for the three review widgets +
// the roles breakdown; cleaned up in a follow-up PR that re-points the
// specs to `[data-widget-id]`.

defineProps<{
  id: string
  shape: WidgetShape
  editMode?: boolean
  legacyDataKpi?: string
  legacyDataBreakdown?: string
}>()
</script>

<template>
  <div
    v-if="shape === 'kpi'"
    class="kpi-tile"
    :data-widget-id="id"
    :data-kpi="legacyDataKpi || undefined"
  >
    <slot />
  </div>
  <article
    v-else
    class="breakdown"
    :data-widget-id="id"
    :data-breakdown="legacyDataBreakdown || undefined"
  >
    <slot />
  </article>
</template>

<style scoped>
.kpi-tile {
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: 2px;
  padding: 0.55rem 0.7rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.breakdown {
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface);
  padding: 0.55rem 0.7rem 0.65rem;
}
</style>

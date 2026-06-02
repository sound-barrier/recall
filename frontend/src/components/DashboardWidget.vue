<script setup lang="ts">
import type { WidgetShape } from '../dashboard/widgets'

// Wrapper chrome for a customizable dashboard widget. The wrapper owns
// the root element + the data-widget-id attribute so MatchesView's
// grid template doesn't have to know each widget's tag/class — it just
// passes `shape` and the wrapper picks the right chrome.
//
// `shape` is the widget's intrinsic visual footprint (compact .kpi-tile
// vs wider .breakdown article). It is NOT the same as which row the
// widget renders in — Phase 3 lets users drag widgets across rows
// regardless of shape. The type is sourced from the registry so a new
// shape value adds to one enum, not two.
//
// `editMode` flips the wrapper into "draggable" mode: the root is
// marked `draggable="true"`, a drag handle appears top-left, and DnD
// + keyboard reorder handlers fire on the consumer's callbacks.
//
// `legacyDataKpi` / `legacyDataBreakdown` keep the pre-refactor e2e
// selectors (`[data-kpi="reviewed-count"]`, `[data-breakdown="roles"]`)
// matching. Populated from the registry for the three review widgets +
// the roles breakdown; cleaned up in a follow-up PR that re-points the
// specs to `[data-widget-id]`.

const props = defineProps<{
  id: string
  shape: WidgetShape
  editMode?: boolean
  // Position in the layout. Only consulted when editMode=true so
  // the consumer can pass undefined for static-mode renders.
  row?: number
  idx?: number
  // Visual hint when this cell is the active drop target. Driven by
  // the parent's useDragReorder.dropHint comparison.
  dropTarget?: boolean
  legacyDataKpi?: string
  legacyDataBreakdown?: string
}>()

const emit = defineEmits<{
  'drag-start':   [id: string, row: number, idx: number, e: DragEvent]
  'drag-end':     []
  'drag-over':    [row: number, idx: number, e: DragEvent]
  'drop':         [row: number, idx: number, e: DragEvent]
  'handle-keydown': [id: string, row: number, idx: number, e: KeyboardEvent]
}>()

function rowOr(): number { return props.row ?? 0 }
function idxOr(): number { return props.idx ?? 0 }
</script>

<template>
  <component
    :is="shape === 'kpi' ? 'div' : 'article'"
    :class="[
      shape === 'kpi' ? 'kpi-tile' : 'breakdown',
      { 'dashboard-widget-editable': editMode, 'dashboard-widget-drop-target': dropTarget },
    ]"
    :data-widget-id="id"
    :data-kpi="legacyDataKpi || undefined"
    :data-breakdown="legacyDataBreakdown || undefined"
    :draggable="editMode ? 'true' : undefined"
    @dragstart="editMode ? emit('drag-start', id, rowOr(), idxOr(), $event) : null"
    @dragend="editMode ? emit('drag-end') : null"
    @dragover="editMode ? emit('drag-over', rowOr(), idxOr(), $event) : null"
    @drop="editMode ? emit('drop', rowOr(), idxOr(), $event) : null"
  >
    <button
      v-if="editMode"
      type="button"
      class="dashboard-drag-handle"
      :aria-label="`Reorder widget ${id}. Arrow keys move; Up/Down change row.`"
      :data-drag-handle="id"
      @keydown="emit('handle-keydown', id, rowOr(), idxOr(), $event)"
    >
      <span aria-hidden="true">⋮⋮</span>
    </button>
    <slot />
  </component>
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
  position: relative;
}

.breakdown {
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface);
  padding: 0.55rem 0.7rem 0.65rem;
  position: relative;
}

/* Edit-mode chrome: dashed accent border + grab cursor so the cell
   reads as "I can be moved" at a glance. The body of the widget
   stays untouched — only the wrapper takes the affordance. */
.dashboard-widget-editable {
  border-style: dashed;
  border-color: var(--accent);
  cursor: grab;
}

.dashboard-widget-editable:active {
  cursor: grabbing;
}

/* Drop-target highlight — the cell the dragged widget will land in
   front of. Bold inset ring + accent fill so the hint reads from
   peripheral vision. */
.dashboard-widget-drop-target {
  box-shadow: inset 0 0 0 2px var(--accent);
  background: color-mix(in srgb, var(--accent-soft) 80%, var(--surface));
}

/* Drag handle — anchored top-left of the wrapper. Eight-dot grip
   glyph (⋮⋮) reads as a handle without an icon font. Stays a true
   <button> so screen readers + keyboard nav reach it; the
   aria-label spells out the keyboard contract. */
.dashboard-drag-handle {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-faint);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  cursor: grab;
  user-select: none;
  transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
  z-index: 1;
}

.dashboard-drag-handle:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.dashboard-drag-handle:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
  color: var(--accent);
}

.dashboard-drag-handle:active {
  cursor: grabbing;
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-drag-handle { transition: none; }
}
</style>

<script setup lang="ts">
import type { WidgetShape } from '../dashboard/widgets'

// Wrapper chrome for a customizable dashboard widget. The wrapper owns
// the root element + the data-widget-id attribute so MatchesView's
// grid template doesn't have to know each widget's tag/class — it just
// passes `shape` and the wrapper picks the right chrome.
//
// `shape` is the widget's intrinsic visual footprint (compact .kpi-tile
// vs wider .breakdown article). It is NOT the same as which row the
// widget renders in — users can drag widgets across rows regardless of
// shape.
//
// There is no edit MODE: every widget is always draggable, and its
// drag handle + trash live on it permanently. Both are quiet by
// default (low opacity) and reveal on hover/focus, so the dossier
// reads as a dossier — not a UI scaffold — while keeping reorder +
// remove one gesture away with no mode to toggle first.
//
// `legacyDataKpi` / `legacyDataBreakdown` keep the pre-refactor e2e
// selectors (`[data-kpi="reviewed-count"]`, `[data-breakdown="roles"]`)
// matching.

const props = defineProps<{
  id: string
  shape: WidgetShape
  // Position in the layout — passed to the drag/keyboard handlers.
  row?: number
  idx?: number
  // Visual hint when this cell is the active drop target. Driven by
  // the parent's useDragReorder.dropHint comparison.
  dropTarget?: boolean
  // True when THIS widget is the one being dragged. Renders as a
  // ghost at the LIVE drop position so the user reads "here's where
  // it will land" while the native drag-image follows the cursor.
  dragging?: boolean
  // True when the widget's registry entry carries a non-empty config
  // schema. Gates the gear-icon affordance — knob-less widgets stay
  // gear-less.
  hasConfig?: boolean
  legacyDataKpi?: string
  legacyDataBreakdown?: string
}>()

const emit = defineEmits<{
  'drag-start':   [id: string, row: number, idx: number, e: DragEvent]
  'drag-end':     []
  'drag-over':    [row: number, idx: number, e: DragEvent]
  'drop':         [row: number, idx: number, e: DragEvent]
  'handle-keydown': [id: string, row: number, idx: number, e: KeyboardEvent]
  'remove':       [id: string]
  // Gear-icon click. MatchesView mounts the WidgetConfigPopover
  // anchored to the rect; carries the click event so the parent can
  // read currentTarget.getBoundingClientRect().
  'configure':    [id: string, e: MouseEvent]
}>()

function rowOr(): number { return props.row ?? 0 }
function idxOr(): number { return props.idx ?? 0 }
</script>

<template>
  <component
    :is="shape === 'kpi' ? 'div' : 'article'"
    :class="[
      shape === 'kpi' ? 'kpi-tile' : 'breakdown',
      'dashboard-widget',
      {
        'dashboard-widget-drop-target': dropTarget,
        'dashboard-widget-dragging': dragging,
      },
    ]"
    :data-widget-id="id"
    :data-kpi="legacyDataKpi || undefined"
    :data-breakdown="legacyDataBreakdown || undefined"
    draggable="true"
    @dragstart="emit('drag-start', id, rowOr(), idxOr(), $event)"
    @dragend="emit('drag-end')"
    @dragover="emit('drag-over', rowOr(), idxOr(), $event)"
    @drop="emit('drop', rowOr(), idxOr(), $event)"
  >
    <button
      type="button"
      class="dashboard-drag-handle"
      :aria-label="`Reorder widget ${id}. Arrow keys move; Up/Down change row.`"
      :data-drag-handle="id"
      @click.stop
      @keydown="emit('handle-keydown', id, rowOr(), idxOr(), $event)"
    >
      <span aria-hidden="true">⋮⋮</span>
    </button>
    <button
      v-if="hasConfig"
      type="button"
      class="dashboard-gear"
      :aria-label="`Configure widget ${id}`"
      :data-widget-config-trigger="id"
      @click.stop="emit('configure', id, $event)"
    >
      <span aria-hidden="true">⚙</span>
    </button>
    <button
      type="button"
      class="dashboard-trash"
      :aria-label="`Remove widget ${id} from the dashboard`"
      :data-widget-remove="id"
      @click.stop="emit('remove', id)"
    >
      <span aria-hidden="true">×</span>
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
  transition: transform 180ms cubic-bezier(0.2, 0.7, 0.3, 1),
              box-shadow 180ms ease,
              border-color 140ms ease;
}

.breakdown {
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface);
  padding: 0.55rem 0.7rem 0.65rem;
  position: relative;
  transition: transform 180ms cubic-bezier(0.2, 0.7, 0.3, 1),
              box-shadow 180ms ease,
              border-color 140ms ease;
}

/* Every widget is draggable. The grab cursor + a quiet accent border
   on HOVER signal "you can move/manage me" without the always-dashed
   "all widgets shout at me" treatment — the resting state stays a
   clean dashboard. */
.dashboard-widget {
  cursor: grab;
}

.dashboard-widget:hover {
  border-style: dashed;
  border-color: var(--accent);
}

.kpi-tile.dashboard-widget:hover {
  background: color-mix(in srgb, var(--accent-soft) 25%, var(--surface-2));
}

.breakdown.dashboard-widget:hover {
  background: color-mix(in srgb, var(--accent-soft) 25%, var(--surface));
}

.dashboard-widget:active {
  cursor: grabbing;
}

/* Drop-target highlight — the cell the dragged widget will land in
   front of. Bold inset ring + accent fill so the hint reads from
   peripheral vision. */
.dashboard-widget-drop-target {
  box-shadow: inset 0 0 0 2px var(--accent);
  background: color-mix(in srgb, var(--accent-soft) 80%, var(--surface)) !important;
}

/* Ghost — the source widget while it's being dragged. Sits at the
   live preview position so the user sees exactly where it will land. */
.dashboard-widget-dragging {
  opacity: 0.35;
  border-style: dashed !important;
  border-color: var(--accent) !important;
  background: color-mix(in srgb, var(--accent) 14%, var(--surface-2)) !important;
  transform: scale(0.985);
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);
}

/* Controls (drag handle + gear + trash) — quiet by default (low
   opacity) so the dossier reads clean, full opacity on hover/focus.
   Always present in the DOM so keyboard reach + focus stay intact. */
.dashboard-drag-handle,
.dashboard-trash,
.dashboard-gear {
  position: absolute;
  top: 4px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-family: var(--mono);
  font-weight: 700;
  line-height: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  cursor: pointer;
  user-select: none;
  z-index: 1;
  opacity: 0.32;
  transition: opacity var(--duration-fast) ease,
              color var(--duration-fast) ease,
              border-color var(--duration-fast) ease,
              background var(--duration-fast) ease;
}

.dashboard-drag-handle {
  left: 4px;
  font-size: 0.85rem;
  color: var(--text-faint);
  cursor: grab;
}

.dashboard-trash {
  right: 4px;
  font-size: 1.1rem;
  color: var(--text-faint);
}

/* The gear sits left of the trash (which keeps the right-edge anchor
   as the destructive control). The 4 px gap matches the corner inset
   so the chrome reads as one row. */
.dashboard-gear {
  right: 36px;
  font-size: 1rem;
  color: var(--text-faint);
}

.kpi-tile:hover .dashboard-drag-handle,
.kpi-tile:hover .dashboard-trash,
.kpi-tile:hover .dashboard-gear,
.breakdown:hover .dashboard-drag-handle,
.breakdown:hover .dashboard-trash,
.breakdown:hover .dashboard-gear,
.dashboard-drag-handle:focus,
.dashboard-trash:focus,
.dashboard-gear:focus,
.dashboard-drag-handle:focus-visible,
.dashboard-trash:focus-visible,
.dashboard-gear:focus-visible {
  opacity: 1;
}

.dashboard-drag-handle:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.dashboard-trash:hover {
  color: var(--loss);
  border-color: var(--loss-line, var(--loss));
  background: color-mix(in srgb, var(--loss) 12%, var(--surface));
}

.dashboard-gear:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.dashboard-drag-handle:focus-visible,
.dashboard-trash:focus-visible,
.dashboard-gear:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.dashboard-drag-handle:active { cursor: grabbing; }

@media (prefers-reduced-motion: reduce) {
  .kpi-tile,
  .breakdown,
  .dashboard-drag-handle,
  .dashboard-trash,
  .dashboard-gear {
    transition: none !important;
  }
}
</style>

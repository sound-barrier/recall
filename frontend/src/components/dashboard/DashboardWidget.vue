<script setup lang="ts">
import type { WidgetShape } from '@/dashboard/widgets'

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
// There is no edit MODE. The manage controls (reorder grip, settings
// gear, remove ×) live in a small cluster at the top-right corner —
// hidden at rest, revealed on hover/focus — so the widget's top-left
// eyebrow label is never covered and the dossier reads clean. No
// border / background change on hover; the controls appearing IS the
// affordance (matching the Campaign Log / Geography section chrome).
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
    <!-- Manage cluster — grouped at the top-right so the widget's
         top-left eyebrow is never covered. Hidden at rest, revealed on
         hover/focus (see CSS). -->
    <div class="dashboard-widget-controls" data-widget-controls>
      <button
        type="button"
        class="dashboard-ctl dashboard-grip"
        :aria-label="`Reorder widget ${id}. Arrow keys move; Up/Down change row.`"
        :data-drag-handle="id"
        @click.stop
        @keydown="emit('handle-keydown', id, rowOr(), idxOr(), $event)"
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <button
        v-if="hasConfig"
        type="button"
        class="dashboard-ctl dashboard-gear"
        :aria-label="`Configure widget ${id}`"
        :data-widget-config-trigger="id"
        @click.stop="emit('configure', id, $event)"
      >
        <span aria-hidden="true">⚙</span>
      </button>
      <button
        type="button"
        class="dashboard-ctl dashboard-trash"
        :aria-label="`Remove widget ${id} from the dashboard`"
        :data-widget-remove="id"
        @click.stop="emit('remove', id)"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
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

/* Every widget is draggable from anywhere; the grip is the explicit
   affordance + keyboard handle. No resting hover treatment — the
   widget box stays exactly as-is, only the control cluster reveals. */
.dashboard-widget:active { cursor: grabbing; }

/* Drop-target highlight — the cell the dragged widget will land in
   front of. Inset ring + accent fill so the hint reads from peripheral
   vision (active-drag feedback, not a resting hover). */
.dashboard-widget-drop-target {
  box-shadow: inset 0 0 0 2px var(--accent);
  background: color-mix(in srgb, var(--accent-soft) 80%, var(--surface)) !important;
}

/* Ghost — the source widget while it's being dragged. Solid (never
   dashed) faint accent so it reads as "this is moving" without the
   dashed-box treatment. */
.dashboard-widget-dragging {
  opacity: 0.4;
  border-color: var(--accent) !important;
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-2)) !important;
  transform: scale(0.985);
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);
}

/* Control cluster — top-right, hidden at rest, revealed on hover/focus.
   Opacity (not pointer-events) gates the quiet state so a click never
   needs a prior hover. */
.dashboard-widget-controls {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 1;
  display: inline-flex;
  gap: 3px;
  opacity: 0;
  transition: opacity var(--duration-fast) ease;
}

.kpi-tile:hover .dashboard-widget-controls,
.breakdown:hover .dashboard-widget-controls,
.dashboard-widget:focus-within .dashboard-widget-controls {
  opacity: 1;
}

/* Compact, native-dialog-sized buttons. */
.dashboard-ctl {
  width: 17px;
  height: 17px;
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
  color: var(--text-faint);
  cursor: pointer;
  user-select: none;
  transition: color var(--duration-fast) ease,
              border-color var(--duration-fast) ease,
              background var(--duration-fast) ease;
}

.dashboard-grip { cursor: grab; font-size: 0.62rem; }
.dashboard-grip:active { cursor: grabbing; }
.dashboard-gear { font-size: 0.62rem; }
.dashboard-trash { font-size: 0.78rem; }

.dashboard-grip:hover,
.dashboard-gear:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.dashboard-trash:hover {
  color: var(--loss);
  border-color: var(--loss-line, var(--loss));
  background: color-mix(in srgb, var(--loss) 12%, var(--surface));
}

.dashboard-ctl:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

@media (prefers-reduced-motion: reduce) {
  .kpi-tile,
  .breakdown,
  .dashboard-widget-controls,
  .dashboard-ctl {
    transition: none !important;
  }
}
</style>

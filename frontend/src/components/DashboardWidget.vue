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
// marked `draggable="true"`, the drag handle + trash button appear in
// the corners, and DnD + keyboard reorder handlers fire on the
// consumer's callbacks. Both controls are hover-revealed (rather than
// always-on) so the dashboard reads as a dashboard, not a UI
// scaffold — but they live on EVERY widget in edit mode (not gated
// to selection) so trash is one click away.
//
// `legacyDataKpi` / `legacyDataBreakdown` keep the pre-refactor e2e
// selectors (`[data-kpi="reviewed-count"]`, `[data-breakdown="roles"]`)
// matching.

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
  // True when this widget is the user's current edit-mode selection
  // — wears the strong accent ring + lift.
  selected?: boolean
  // True when THIS widget is the one being dragged. Renders as a
  // ghost (dashed accent border, low opacity, slight scale-down) at
  // the LIVE drop position so the user reads "here's where it will
  // land" while the browser's native drag-image preview follows
  // the cursor.
  dragging?: boolean
  // True when the widget's registry entry carries a non-empty
  // config schema. Gates the gear-icon affordance — empty-schema
  // widgets stay knob-less. MatchesView precomputes this so the
  // widget doesn't have to walk the registry.
  //
  // The gear is independent of edit mode: edit mode is for moving
  // widgets, the gear is for tuning what one shows. Settings are a
  // read-time concern, not a layout concern.
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
  // Edit-mode interactions on the widget body itself.
  'select':       [id: string]
  'remove':       [id: string]
  // Gear-icon click. MatchesView mounts the WidgetConfigPopover
  // anchored to the rect; carries the click event so the parent
  // can read currentTarget.getBoundingClientRect().
  'configure':    [id: string, e: MouseEvent]
}>()

function rowOr(): number { return props.row ?? 0 }
function idxOr(): number { return props.idx ?? 0 }

function onRootClick() {
  if (!props.editMode) return
  emit('select', props.id)
}
</script>

<template>
  <component
    :is="shape === 'kpi' ? 'div' : 'article'"
    :class="[
      shape === 'kpi' ? 'kpi-tile' : 'breakdown',
      {
        'dashboard-widget-editable': editMode,
        'dashboard-widget-drop-target': dropTarget,
        'dashboard-widget-selected': editMode && selected,
        'dashboard-widget-dragging': dragging,
      },
    ]"
    :data-widget-id="id"
    :data-kpi="legacyDataKpi || undefined"
    :data-breakdown="legacyDataBreakdown || undefined"
    :draggable="editMode ? 'true' : undefined"
    @click="onRootClick"
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
      @click.stop
      @keydown="emit('handle-keydown', id, rowOr(), idxOr(), $event)"
    >
      <span aria-hidden="true">⋮⋮</span>
    </button>
    <button
      v-if="hasConfig"
      type="button"
      :class="['dashboard-gear', { 'dashboard-gear-inset': editMode }]"
      :aria-label="`Configure widget ${id}`"
      :data-widget-config-trigger="id"
      @click.stop="emit('configure', id, $event)"
    >
      <span aria-hidden="true">⚙</span>
    </button>
    <button
      v-if="editMode"
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

/* Edit-mode chrome — quieter than the previous always-dashed
   treatment. The dossier-level dot-grid workspace pattern signals
   edit mode; the widget just shifts its border to dashed-accent on
   HOVER (or when selected). Avoids the "all widgets shout at me"
   feeling of always-dashed borders. */
.dashboard-widget-editable {
  cursor: grab;
  border-color: color-mix(in srgb, var(--border) 60%, var(--accent));
}

.dashboard-widget-editable:hover {
  border-style: dashed;
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent-soft) 25%, transparent), var(--surface-2);
}

.kpi-tile.dashboard-widget-editable:hover {
  background: color-mix(in srgb, var(--accent-soft) 25%, var(--surface-2));
}

.breakdown.dashboard-widget-editable:hover {
  background: color-mix(in srgb, var(--accent-soft) 25%, var(--surface));
}

.dashboard-widget-editable:active {
  cursor: grabbing;
}

/* Drop-target highlight — the cell the dragged widget will land in
   front of. Bold inset ring + accent fill so the hint reads from
   peripheral vision. */
.dashboard-widget-drop-target {
  box-shadow: inset 0 0 0 2px var(--accent);
  background: color-mix(in srgb, var(--accent-soft) 80%, var(--surface)) !important;
}

/* Confident selection state — strong inset ring, subtle lift, scale,
   and shadow so the picked widget unambiguously claims the eye. The
   transform is small (1.5%) so it doesn't push siblings around in
   the auto-fit grid; the shadow does the heavier visual work. */
.dashboard-widget-selected {
  border-style: solid !important;
  border-color: var(--accent) !important;
  box-shadow: inset 0 0 0 2px var(--accent),
              0 14px 28px -16px color-mix(in srgb, var(--accent) 80%, transparent);
  transform: translateY(-2px) scale(1.015);
  z-index: 2;
}

/* Ghost — the source widget while it's being dragged. Sits at the
   live preview position so the user sees exactly where it will
   land. Lower opacity + dashed accent border + faint accent fill
   read as "placeholder for the dragged item" without disappearing
   entirely (which would leave a confusing gap). */
.dashboard-widget-dragging {
  opacity: 0.35;
  border-style: dashed !important;
  border-color: var(--accent) !important;
  background: color-mix(in srgb, var(--accent) 14%, var(--surface-2)) !important;
  transform: scale(0.985);
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);
}

/* Controls (drag handle + trash) — quiet by default (low opacity)
   so the dashboard reads as a dashboard, not a UI scaffold. Full
   opacity on hover/focus/selection. Staying always-present-in-DOM
   keeps keyboard reach + focus intact (an opacity:0 default
   confused programmatic focus dispatch in some browsers). */
.dashboard-drag-handle,
.dashboard-trash,
.dashboard-gear {
  position: absolute;
  top: 4px;
  width: 20px;
  height: 20px;
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
  opacity: 0.35;
  transition: opacity 160ms ease,
              color 140ms ease, border-color 140ms ease, background 140ms ease;
}

.dashboard-drag-handle {
  left: 4px;
  font-size: 0.7rem;
  color: var(--text-faint);
  cursor: grab;
}

.dashboard-trash {
  right: 4px;
  font-size: 1rem;
  color: var(--text-faint);
}

/* Gear is independent of edit mode: visible whenever the widget has
   a non-empty config schema. Default sits at the right edge; in edit
   mode it shifts left to make room for the trash button (which keeps
   its right-edge anchor as the destructive control). */
.dashboard-gear {
  right: 4px;
  font-size: 0.85rem;
  color: var(--text-faint);
}

.dashboard-gear-inset {
  right: 26px;
}

.dashboard-widget-editable:hover .dashboard-drag-handle,
.dashboard-widget-editable:hover .dashboard-trash,
.dashboard-widget-selected .dashboard-drag-handle,
.dashboard-widget-selected .dashboard-trash,
.kpi-tile:hover .dashboard-gear,
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

  .dashboard-widget-selected {
    transform: none;
  }
}
</style>

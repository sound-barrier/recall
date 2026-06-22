import { computed, ref, watch } from 'vue'

import { useDashboardLayout } from '@/composables/dashboard/useDashboardLayout'
import { useDragReorder } from '@/composables/dashboard/useDragReorder'
import { widgetById, type WidgetDef } from '@/dashboard/widgets'

// The dossier head's customizable widget grid: the persisted row layout, the
// live-reflow drag-reorder preview, the trash→undo registry, and the per-widget
// settings popover anchor. Extracted from MatchesDossierHead.vue so the SFC keeps
// only the set-summary headline/subline + the narrow trigger; the grid concern
// (its own cohesive state machine) lives here. Behaviour is unchanged — the SFC
// destructures these and renders them exactly as before.
export function useDashboardGrid() {
  // The persisted row layout is the SINGLE source of truth for "is this widget
  // rendered" — membership in layout.rows.value[*] means visible.
  const dashboardLayout = useDashboardLayout()

  // Live-reflow drag preview. Held as a plain ref so it can be referenced from
  // dragReorder.onMove (declared next) without a TDZ tangle — the watcher below
  // keeps it in sync with the drag state. While a drag is in flight AND over a
  // valid drop target, this holds a layout with the dragged widget at the
  // prospective drop position; other widgets reflow via the TransitionGroup FLIP
  // move. On drop the preview becomes the persisted layout in one atomic write.
  const previewLayout = ref<Record<number, string[]> | null>(null)

  // Drag-reorder primitive. Tracks dragging (source) + dropHint (cell under the
  // cursor) and emits onMove on a successful drop. onMove uses previewLayout to
  // pick "commit the live preview" (drag) vs "traditional move" (keyboard).
  const dragReorder = useDragReorder({
    onMove: (id, fromRow, fromIdx, toRow, toIdx) => {
      const preview = previewLayout.value
      if (preview) {
        dashboardLayout.setLayout(preview)
      } else {
        dashboardLayout.move(id, fromRow, fromIdx, toRow, toIdx)
      }
    },
    rowSize: (row) => {
      const r = dashboardRows.value.find((x) => x.index === row)
      return r ? r.widgets.length : 0
    },
  })

  const dashboardRows = computed(() => {
    const layout = previewLayout.value ?? dashboardLayout.rows.value
    return Object.keys(layout)
      .map((k) => Number(k))
      .sort((a, b) => a - b)
      .map((rowIdx) => ({
        index: rowIdx,
        widgets: (layout[rowIdx] ?? [])
          .map((id) => widgetById(id))
          .filter((def): def is WidgetDef => def !== undefined),
      }))
  })

  // Recompute the preview whenever the drag state changes. Default flush 'pre'
  // runs before the next DOM update so dashboardRows sees a fresh preview on the
  // same render tick.
  watch(
    [dragReorder.dragging, dragReorder.dropHint, dashboardLayout.rows],
    ([dragState, hint, layout]) => {
      if (!dragState || !hint) {
        previewLayout.value = null
        return
      }
      const next: Record<number, string[]> = {}
      for (const [k, v] of Object.entries(layout)) {
        next[Number(k)] = [...v]
      }
      // Remove the dragged widget from wherever it currently lives. Walking every
      // row keeps this robust if the source coords on dragState went stale.
      for (const key of Object.keys(next)) {
        const rowIdx = Number(key)
        const arr = next[rowIdx]!
        const idx = arr.indexOf(dragState.id)
        if (idx !== -1) {
          arr.splice(idx, 1)
          next[rowIdx] = arr
          break
        }
      }
      const targetRow = next[hint.row] ?? []
      const insertAt = Math.max(0, Math.min(hint.idx, targetRow.length))
      targetRow.splice(insertAt, 0, dragState.id)
      next[hint.row] = targetRow
      previewLayout.value = next
    },
    { deep: true },
  )

  // There is no edit MODE — widgets carry their own always-on (hover-revealed)
  // drag + remove chrome, so the only surface left is re-adding what you removed.
  const showManageMenu = ref(false)

  // Gear-popover state. configureWidgetId is the widget whose settings popover is
  // mounted; configureAnchor is the gear button's rect at click time. We re-capture
  // the rect on every open so resizes/scrolls produce a fresh anchor.
  const configureWidgetId = ref<string | null>(null)
  const configureAnchor = ref<DOMRect | null>(null)
  const configureDef = computed(() =>
    configureWidgetId.value ? widgetById(configureWidgetId.value) ?? null : null,
  )

  function onWidgetConfigure(id: string, e: MouseEvent) {
    const target = e.currentTarget as HTMLElement | null
    if (!target) return
    configureWidgetId.value = id
    configureAnchor.value = target.getBoundingClientRect()
  }

  function closeWidgetConfigure() {
    configureWidgetId.value = null
    configureAnchor.value = null
  }

  // Undo registry — snapshots the widget that was just trashed so the undo toast
  // can put it back. We capture eyebrow + row + idx BEFORE removeFromRow() because
  // afterwards the row/idx context is gone. Token bumps per trash so the toast
  // re-runs its slide-in + countdown even for back-to-back removes of the same id.
  const pendingUndo = ref<{ id: string; eyebrow: string; row: number; idx: number; token: number } | null>(null)
  let undoTokenSeq = 0

  function onWidgetRemove(id: string) {
    const def = widgetById(id)
    if (!def) return
    let foundRow = def.defaultRow
    let foundIdx = 0
    for (const row of dashboardRows.value) {
      const idxInRow = row.widgets.findIndex((w) => w.id === id)
      if (idxInRow !== -1) {
        foundRow = row.index
        foundIdx = idxInRow
        break
      }
    }
    dashboardLayout.removeFromRow(id)
    undoTokenSeq++
    pendingUndo.value = { id, eyebrow: def.eyebrow, row: foundRow, idx: foundIdx, token: undoTokenSeq }
  }

  function onUndoRemove(token: number) {
    const pending = pendingUndo.value
    if (!pending || pending.token !== token) return
    // appendToRow respects the soft-threshold spill so an over-full row spills on
    // undo too — consistent with new-add mechanics.
    dashboardLayout.appendToRow(pending.row, pending.id)
    pendingUndo.value = null
  }

  function onDismissUndo(token: number) {
    if (pendingUndo.value?.token === token) {
      pendingUndo.value = null
    }
  }

  // Three review-widget e2e specs key on data-kpi="..."; the roles breakdown spec
  // keys on data-breakdown="roles". Keep the legacy attrs on the wrapper during
  // Phase 1; a follow-up re-points the specs to [data-widget-id="..."].
  const LEGACY_DATA_KPI: Record<string, string> = {
    'reviewed-count': 'reviewed-count',
    'days-since-review': 'days-since-review',
    'wld-since-review': 'wld-since-review',
  }
  const LEGACY_DATA_BREAKDOWN: Record<string, string> = {
    'top-roles': 'roles',
  }

  return {
    dashboardRows,
    dragReorder,
    showManageMenu,
    configureWidgetId,
    configureAnchor,
    configureDef,
    onWidgetConfigure,
    closeWidgetConfigure,
    pendingUndo,
    onWidgetRemove,
    onUndoRemove,
    onDismissUndo,
    LEGACY_DATA_KPI,
    LEGACY_DATA_BREAKDOWN,
  }
}

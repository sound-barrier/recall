import { computed, ref } from 'vue'
import {
  usePersistedRef,
  parseJsonRecord,
  serializeJsonRecord,
} from '@/composables/shared/usePersistedRef'

// Drag-to-resize for the data-density table columns (the spreadsheet feel).
// Widths persist per profile so a layout survives reloads. Keyed by the column
// id ('select' for the checkbox gutter, otherwise the TableSortCol). A column
// with no stored width falls back to its natural default below.

const STORAGE_KEY = 'recall.matchesTableColWidths'
const MIN_WIDTH = 36

// Natural per-column widths (px). table-layout:fixed needs every column sized,
// so these seed the colgroup until the user drags one.
export const DEFAULT_COLUMN_WIDTHS: Readonly<Record<string, number>> = {
  select: 34,
  date: 132,
  map: 132,
  playMode: 96,
  queue: 96,
  hero: 150,
  role: 72,
  eliminations: 44,
  assists: 44,
  deaths: 44,
  tags: 112,
  edited: 56,
  manual: 64,
  result: 86,
}

function isWidthMap(decoded: unknown): decoded is Record<string, number> {
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return false
  return Object.values(decoded as Record<string, unknown>).every(
    (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
  )
}

export function useColumnResize() {
  const { value: stored, set } = usePersistedRef<Record<string, number>>({
    key: STORAGE_KEY,
    defaultValue: {},
    parse: parseJsonRecord(isWidthMap),
    serialize: serializeJsonRecord,
  })

  // Live width during an in-flight drag — applied without persisting on every
  // pointermove, then committed on pointerup.
  const dragging = ref<{ col: string; px: number } | null>(null)

  function colWidth(col: string): number {
    if (dragging.value?.col === col) return dragging.value.px
    return stored.value[col] ?? DEFAULT_COLUMN_WIDTHS[col] ?? 80
  }

  function onResizeStart(col: string, event: PointerEvent): void {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = colWidth(col)
    const move = (e: PointerEvent) => {
      dragging.value = { col, px: Math.max(MIN_WIDTH, Math.round(startWidth + e.clientX - startX)) }
    }
    const up = () => {
      if (dragging.value) set({ ...stored.value, [dragging.value.col]: dragging.value.px })
      dragging.value = null
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  // Persist an explicit width — the double-click auto-fit measures the column's
  // widest rendered content and commits it here. Clamped to the drag minimum.
  function setWidth(col: string, px: number): void {
    set({ ...stored.value, [col]: Math.max(MIN_WIDTH, Math.round(px)) })
  }

  return { colWidth, onResizeStart, setWidth, dragging: computed(() => dragging.value) }
}

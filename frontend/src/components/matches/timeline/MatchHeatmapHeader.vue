<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef } from 'vue'
import type { MatchRecord } from '@/api'
import { useMatchHeatmap } from '@/composables/matches/useMatchHeatmap'

// Calendar heatmap viz — 7 rows × N week columns of one cell per day.
// Win-rate drives hue (green → red via --win / --loss); volume drives
// saturation. Empty cells flatten to --surface-2.
//
// Cell size auto-scales by window: at 3M (13 columns) cells render
// larger so the grid carries presence; at 12M (52 columns) cells
// shrink so the whole year still fits without horizontal scroll.
//
// State + chrome (eyebrow, range label, 3M/6M/12M picker, legend)
// all live on the parent MatchTimelineHeader so the heatmap and the
// sparkline beside it stay in lock-step.

const props = defineProps<{
  records: MatchRecord[]
  filterFrom: string
  filterTo: string
  // 13 / 26 / 52 — picked by the wrapper's 3M/6M/12M control.
  windowWeeks: number
  weekStartsOn?: 0 | 1
}>()

const emit = defineEmits<{
  'update:filter-from': [value: string]
  'update:filter-to':   [value: string]
}>()

const recordsRef    = toRef(props, 'records')
const windowWeeksRef = toRef(props, 'windowWeeks')

const model = useMatchHeatmap(recordsRef, {
  weekStartsOn: props.weekStartsOn ?? 0,
  windowWeeks: windowWeeksRef,
})

// Adaptive cell sizing — the SVG fills its column comfortably at
// every window pick. Sizes were eyeballed against the 1200px-wide
// FilterRail row on a 1440px viewport. The picker derives windowWeeks
// from a 3 / 6 / 12 month pick, so we key off that:
//   13 weeks → 24px cells
//   26 weeks → 18px cells
//   52 weeks → 12px cells
const CELL = computed(() => {
  if (props.windowWeeks <= 13) return 24
  if (props.windowWeeks <= 26) return 18
  return 12
})
const GAP = 2
const STEP = computed(() => CELL.value + GAP)
const LEFT_GUTTER = 24
const TOP_GUTTER  = 16

const width  = computed(() => LEFT_GUTTER + model.value.weeks * STEP.value)
const height = computed(() => TOP_GUTTER + 7 * STEP.value)

const dayLabels = computed(() => {
  const labels = props.weekStartsOn === 1
    ? ['', 'Tue', '', 'Thu', '', 'Sat', '']
    : ['', 'Mon', '', 'Wed', '', 'Fri', '']
  return labels.map((label, row) => ({
    label,
    y: TOP_GUTTER + row * STEP.value + CELL.value / 2 + 3,
  }))
})

function cellBaseFill(cell: { winRate: number; total: number; empty: boolean }): string {
  if (cell.empty) return 'var(--heatmap-empty)'
  const wrPct = Math.round(cell.winRate * 100)
  const sat = Math.round(20 + Math.min(1, cell.total / Math.max(model.value.maxTotal, 1)) * 80)
  return `color-mix(in srgb, color-mix(in srgb, var(--win) ${wrPct}%, var(--loss)) ${sat}%, var(--heatmap-empty))`
}

// In-range cells blend toward the accent so the whole span reads as one
// contiguous block (empty days included) instead of separate outlined boxes.
function cellFill(cell: { date: string; winRate: number; total: number; empty: boolean }): string {
  const base = cellBaseFill(cell)
  if (isActive(cell)) return `color-mix(in srgb, var(--accent) 55%, ${base})`
  return base
}

function cellLabel(cell: { date: string; wins: number; losses: number; draws: number; total: number; winRate: number; empty: boolean }): string {
  if (cell.empty) return `${formatHumanDate(cell.date)} — no matches`
  const wr = Math.round(cell.winRate * 100)
  const drawSuffix = cell.draws > 0 ? `, ${cell.draws} draw${cell.draws === 1 ? '' : 's'}` : ''
  return `${formatHumanDate(cell.date)} — ${cell.wins} wins, ${cell.losses} losses${drawSuffix}, ${wr}% win rate`
}

function formatHumanDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Currently-active filter range, if any. `from` / `to` are
// YYYY-MM-DD strings (the date prefix of the datetime-local
// filterFrom / filterTo refs); cells whose date falls inside light
// up as "active." Single-day picks (from === to) collapse to one
// glowing cell; sparkline brushes light up every cell between the
// endpoints — same selection vocabulary as the band on the
// sparkline itself, so flipping a filter from either viz produces
// a consistent "what's the active range" readout across both.
const activeRange = computed(() => {
  if (!props.filterFrom || !props.filterTo) return null
  return {
    from: props.filterFrom.slice(0, 10),
    to:   props.filterTo.slice(0, 10),
  }
})

const cellByDate = computed(() => {
  const m = new Map<string, { date: string; empty: boolean }>()
  for (const c of model.value.cells) m.set(c.date, c)
  return m
})

// Grid position → date, so a pointer coordinate maps straight to a day.
const cellByGrid = computed(() => {
  const m = new Map<string, string>()
  for (const c of model.value.cells) m.set(`${c.weekIndex}|${c.dayOfWeek}`, c.date)
  return m
})

// ─── Drag-to-select a date range ──────────────────────────────────
// Press-drag-release across the calendar selects the inclusive DATE span
// from the anchor day to the release day. Because the span is computed by
// date min/max (not a grid rectangle), a diagonal drag still yields one
// CONTIGUOUS block — empty days inside the span are part of it. A plain
// click (down + up on one day, no movement) picks that single day; a click
// on an empty day clears the active range. Only a real drag makes a range,
// and there is only ever ONE range — a new gesture replaces the last.
const svgRef     = ref<SVGSVGElement | null>(null)
const dragAnchor = ref<string | null>(null) // YYYY-MM-DD
const dragHover  = ref<string | null>(null)
const isDragging = computed(() => dragAnchor.value !== null)

// The span to highlight: the live drag preview while dragging, else the
// committed filter range. One source of truth → never two boxes.
const highlightRange = computed(() => {
  if (dragAnchor.value && dragHover.value) {
    const a = dragAnchor.value
    const b = dragHover.value
    return a <= b ? { from: a, to: b } : { from: b, to: a }
  }
  return activeRange.value
})

function isActive(cell: { date: string }): boolean {
  const range = highlightRange.value
  if (!range) return false
  return cell.date >= range.from && cell.date <= range.to
}

// Map a pointer event to the day under it via the SVG geometry. Robust to
// pointer capture (the gesture is captured on the SVG, so per-cell enter
// events never fire) and to any CSS scaling of the viewBox.
function dateFromEvent(e: MouseEvent): string | null {
  const svg = svgRef.value
  if (!svg) return null
  const rect = svg.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const sx = (e.clientX - rect.left) * (width.value / rect.width)
  const sy = (e.clientY - rect.top) * (height.value / rect.height)
  const wk = Math.floor((sx - LEFT_GUTTER) / STEP.value)
  const dw = Math.floor((sy - TOP_GUTTER) / STEP.value)
  if (wk < 0 || dw < 0 || dw > 6) return null
  return cellByGrid.value.get(`${wk}|${dw}`) ?? null
}

function onCellDown(cell: { date: string }, e: MouseEvent) {
  e.preventDefault() // stop the native text/drag selection that swallows mousemove
  dragAnchor.value = cell.date
  dragHover.value  = cell.date
  // Mouse (not pointer) events: a pointerdown sets implicit pointer capture on
  // the start cell, which swallows the cross-cell moves; window-level mouse
  // listeners also keep the drag alive once the cursor leaves the grid.
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (dragAnchor.value === null) return
  const date = dateFromEvent(e)
  if (date) dragHover.value = date
}

function onMouseUp() {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  const anchor = dragAnchor.value
  const hover  = dragHover.value
  dragAnchor.value = null
  dragHover.value  = null
  if (anchor === null) return
  if (hover === null || hover === anchor) {
    commitClick(anchor)
    return
  }
  const from = anchor <= hover ? anchor : hover
  const to   = anchor <= hover ? hover : anchor
  emit('update:filter-from', `${from}T00:00`)
  emit('update:filter-to',   `${to}T23:59`)
}

function commitClick(date: string) {
  // A bare click on an empty day clears the active range ("cancel the box").
  if (cellByDate.value.get(date)?.empty) {
    emit('update:filter-from', '')
    emit('update:filter-to', '')
    return
  }
  // Re-clicking the active single day toggles it off.
  const range = activeRange.value
  if (range && range.from === range.to && range.from === date) {
    emit('update:filter-from', '')
    emit('update:filter-to', '')
    return
  }
  emit('update:filter-from', `${date}T00:00`)
  emit('update:filter-to',   `${date}T23:59`)
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <div
    class="match-heatmap"
    :class="{ 'is-dragging': isDragging }"
    role="grid"
    :aria-label="`Match calendar — ${model.start} to ${model.end}`"
  >
    <svg
      ref="svgRef"
      class="heatmap-svg"
      :viewBox="`0 0 ${width} ${height}`"
      :width="width"
      :height="height"
      role="presentation"
    >
      <g class="month-labels" aria-hidden="true">
        <text
          v-for="m in model.monthLabels"
          :key="`${m.weekIndex}-${m.label}`"
          :x="LEFT_GUTTER + m.weekIndex * STEP"
          :y="TOP_GUTTER - 4"
        >{{ m.label }}</text>
      </g>

      <g class="day-labels" aria-hidden="true">
        <text
          v-for="(d, i) in dayLabels"
          :key="i"
          :x="LEFT_GUTTER - 4"
          :y="d.y"
          text-anchor="end"
        >{{ d.label }}</text>
      </g>

      <g class="cells">
        <rect
          v-for="cell in model.cells"
          :key="cell.date"
          class="heatmap-cell"
          :class="{ active: isActive(cell), empty: cell.empty }"
          :data-date="cell.date"
          :data-empty="cell.empty ? 'true' : 'false'"
          :x="LEFT_GUTTER + cell.weekIndex * STEP"
          :y="TOP_GUTTER + cell.dayOfWeek * STEP"
          :width="CELL"
          :height="CELL"
          rx="2"
          :fill="cellFill(cell)"
          :aria-label="cellLabel(cell)"
          role="gridcell"
          :tabindex="cell.empty ? -1 : 0"
          @mousedown="onCellDown(cell, $event)"
          @keydown.enter.prevent="commitClick(cell.date)"
          @keydown.space.prevent="commitClick(cell.date)"
        />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.match-heatmap {
  --heatmap-empty: color-mix(in srgb, var(--surface-2) 92%, var(--border));

  flex: 0 0 auto;

  /* Drag-select must not trigger the browser's native blue selection box. */
  user-select: none;
  touch-action: none;
}

.heatmap-svg {
  display: block;
}

.month-labels text {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  fill: var(--text-faint);
}

.day-labels text {
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.06em;
  fill: var(--text-faint);
}

.heatmap-cell {
  cursor: pointer;
  stroke: color-mix(in srgb, var(--text) 8%, transparent);
  stroke-width: 0.5;
  transition: stroke 140ms ease, transform 140ms ease;
  transform-origin: center;
  transform-box: fill-box;
}

.heatmap-cell:hover {
  stroke: var(--accent);
  stroke-width: 1.5;
  transform: scale(1.18);
}

.heatmap-cell:focus-visible {
  outline: none;
  stroke: var(--accent);
  stroke-width: 1.8;
}

/* In-range cells carry an accent-blended fill (cellFill) + only a faint
   stroke so the span reads as ONE contiguous block, not a row of separately
   outlined boxes. No glow / no scale — that's what made a range look like
   multiple boxes. */
.heatmap-cell.active {
  stroke: color-mix(in srgb, var(--accent) 45%, transparent);
  stroke-width: 0.5;
}

/* While dragging out a range, suppress the per-cell hover pop so the block
   stays visually stable as the cursor sweeps across it. */
.match-heatmap.is-dragging .heatmap-cell:hover {
  stroke-width: 0.5;
  transform: none;
}

.heatmap-cell.empty {
  cursor: default;
}

.heatmap-cell.empty:hover {
  stroke: color-mix(in srgb, var(--text) 8%, transparent);
  stroke-width: 0.5;
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  .heatmap-cell,
  .heatmap-cell:hover {
    transition: none;
    transform: none;
  }
}
</style>

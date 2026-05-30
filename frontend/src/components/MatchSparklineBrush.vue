<script setup lang="ts">
import { computed, ref, toRef, onBeforeUnmount } from 'vue'
import type { MatchRecord } from '../api'
import { useMatchHeatmap } from '../composables/useMatchHeatmap'

// Brushable bar sparkline — answers "when did I play, and how much?".
// Sits to the right of the calendar heatmap on the Matches view; they
// share the same model (cells are already chronological). Each cell
// becomes one bar; height encodes daily match count, fill encodes the
// W% (win-tinted bar when you won most of the day, loss-tinted when
// you lost). Empty days render a 1-px baseline tick so the brush
// targets are always reachable.
//
// Brush UX:
//   - mousedown → record start cell; show a translucent selection
//     rect that grows with the cursor.
//   - mousemove → expand the rect; emit filterFrom / filterTo on
//     mouseup, not during drag, so the cards list doesn't thrash on
//     every pixel.
//   - mousedown without drag (mouseup at the same x) → clear the
//     filter, "click outside a selection" style.
//
// Active filter (set elsewhere) shows as a 50%-opaque accent rect
// over the matching bar range; the brush is the "edit" affordance,
// and the visible rect is the "current value".

const props = defineProps<{
  records: MatchRecord[]
  filterFrom: string
  filterTo: string
  windowWeeks: number
  weekStartsOn?: 0 | 1
}>()

const emit = defineEmits<{
  'update:filter-from': [value: string]
  'update:filter-to':   [value: string]
}>()

const recordsRef     = toRef(props, 'records')
const windowWeeksRef = toRef(props, 'windowWeeks')

const model = useMatchHeatmap(recordsRef, {
  weekStartsOn: props.weekStartsOn ?? 0,
  windowWeeks: windowWeeksRef,
})

// Sized for the "right side of the FilterRail row" slot — the
// heatmap consumes the left ~360-750px (window-dependent); this
// fills the remainder with the same vertical footprint so the two
// strips visually align top + bottom.
const HEIGHT = 96
const PADDING = { top: 12, right: 8, bottom: 14, left: 8 }
const BAR_MIN_WIDTH = 1.5

const dayCount = computed(() => model.value.cells.length)
const usableWidth = ref(420) // updated by resize observer; sane default
const barWidth = computed(() =>
  Math.max(BAR_MIN_WIDTH, (usableWidth.value - PADDING.left - PADDING.right) / Math.max(dayCount.value, 1)),
)
const innerHeight = HEIGHT - PADDING.top - PADDING.bottom

const svgRef = ref<SVGSVGElement | null>(null)
const hostRef = ref<HTMLElement | null>(null)

let ro: ResizeObserver | null = null
function attachHost(el: HTMLElement | null) {
  hostRef.value = el
  if (!el) return
  if (ro) ro.disconnect()
  ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      // Width of the host container — drives the SVG's :width attr.
      usableWidth.value = entry.contentRect.width || usableWidth.value
    }
  })
  ro.observe(el)
  usableWidth.value = el.getBoundingClientRect().width || usableWidth.value
}
onBeforeUnmount(() => { if (ro) { ro.disconnect(); ro = null } })

function barX(i: number): number {
  return PADDING.left + i * barWidth.value
}

function barHeight(total: number): number {
  if (model.value.maxTotal === 0) return 0
  // Floor at 2px for non-empty days so a single-match day is visible.
  const ratio = total / model.value.maxTotal
  return Math.max(2, Math.round(ratio * innerHeight))
}

function barFill(cell: { winRate: number; total: number; empty: boolean }): string {
  if (cell.empty) return 'var(--sparkline-empty)'
  const wrPct = Math.round(cell.winRate * 100)
  return `color-mix(in srgb, var(--win) ${wrPct}%, var(--loss))`
}

function barLabel(cell: { date: string; wins: number; losses: number; total: number }): string {
  if (cell.total === 0) return `${cell.date} — no matches`
  return `${cell.date} — ${cell.total} match${cell.total === 1 ? '' : 'es'} (${cell.wins}W ${cell.losses}L)`
}

// ─── Brush ─────────────────────────────────────────────────────
//
// dragStartIndex / dragEndIndex are in cell-index space, not pixel
// space, so the selection rectangle snaps cleanly to bar columns.

const dragStartIndex = ref<number | null>(null)
const dragEndIndex = ref<number | null>(null)

const isDragging = computed(() => dragStartIndex.value !== null)

// Visible selection band — during a drag this reflects the user's
// in-flight choice; otherwise it reflects the currently-applied
// filterFrom/filterTo so the user can SEE the active range.
const selectionBand = computed<{ x: number; width: number } | null>(() => {
  let a: number | null = null
  let b: number | null = null
  if (isDragging.value) {
    a = dragStartIndex.value
    b = dragEndIndex.value ?? dragStartIndex.value
  } else if (props.filterFrom && props.filterTo) {
    a = model.value.cells.findIndex(c => c.date === props.filterFrom.slice(0, 10))
    b = model.value.cells.findIndex(c => c.date === props.filterTo.slice(0, 10))
  }
  if (a == null || b == null || a < 0 || b < 0) return null
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return {
    x: barX(lo),
    width: barX(hi) - barX(lo) + barWidth.value,
  }
})

function xToIndex(clientX: number): number {
  const el = svgRef.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  const localX = clientX - rect.left - PADDING.left
  const idx = Math.floor(localX / barWidth.value)
  return Math.max(0, Math.min(dayCount.value - 1, idx))
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  const idx = xToIndex(e.clientX)
  dragStartIndex.value = idx
  dragEndIndex.value = idx
  // Capture on the SVG (currentTarget) so move events keep landing
  // on it even if the cursor wanders off a bar onto an empty zone.
  const host = e.currentTarget as Element
  try { host.setPointerCapture?.(e.pointerId) } catch (_) { /* swallow — browsers vary */ }
  e.preventDefault()
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value) return
  dragEndIndex.value = xToIndex(e.clientX)
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging.value) return
  const start = dragStartIndex.value!
  const end = dragEndIndex.value ?? start
  dragStartIndex.value = null
  dragEndIndex.value = null
  const host = e.currentTarget as Element
  try { host.releasePointerCapture?.(e.pointerId) } catch (_) { /* swallow */ }
  // No drag (mouse came up on the same bar) → treat as a "click
  // outside selection" gesture and clear the active filter.
  if (start === end) {
    emit('update:filter-from', '')
    emit('update:filter-to', '')
    return
  }
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  const fromDate = model.value.cells[lo]?.date
  const toDate = model.value.cells[hi]?.date
  if (!fromDate || !toDate) return
  emit('update:filter-from', `${fromDate}T00:00`)
  emit('update:filter-to', `${toDate}T23:59`)
}
</script>

<template>
  <div
    :ref="(el) => attachHost(el as HTMLElement | null)"
    class="match-sparkline"
    role="img"
    :aria-label="`Match volume ${model.start} to ${model.end}; drag to set a date range`"
  >
    <svg
      ref="svgRef"
      class="sparkline-svg"
      :width="usableWidth"
      :height="HEIGHT"
      :class="{ dragging: isDragging }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <!-- Baseline rule across the bottom for the empty-day ticks
           to sit on. -->
      <line
        class="baseline"
        :x1="PADDING.left"
        :x2="usableWidth - PADDING.right"
        :y1="HEIGHT - PADDING.bottom + 0.5"
        :y2="HEIGHT - PADDING.bottom + 0.5"
      />

      <!-- Selection band — drawn under the bars so they still read,
           but with enough alpha to register as a range. -->
      <rect
        v-if="selectionBand"
        class="selection-band"
        :class="{ live: isDragging }"
        :x="selectionBand.x"
        :y="PADDING.top - 2"
        :width="selectionBand.width"
        :height="innerHeight + 4"
        rx="2"
      />

      <!-- Bars. Empty days get a 1px tick on the baseline so the
           brush hit zones stay contiguous. -->
      <g class="bars">
        <rect
          v-for="(cell, i) in model.cells"
          :key="cell.date"
          class="sparkline-bar"
          :class="{ empty: cell.empty }"
          :data-date="cell.date"
          :x="barX(i)"
          :y="HEIGHT - PADDING.bottom - barHeight(cell.total)"
          :width="Math.max(barWidth - 0.5, BAR_MIN_WIDTH - 0.5)"
          :height="cell.empty ? 1.5 : barHeight(cell.total)"
          :fill="barFill(cell)"
          role="img"
          :aria-label="barLabel(cell)"
        />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.match-sparkline {
  --sparkline-empty: color-mix(in srgb, var(--text-faint) 32%, transparent);

  flex: 1 1 auto;
  min-width: 220px;
}

.sparkline-svg {
  display: block;

  /* width comes from the :width attribute (synced to the parent
     container via ResizeObserver) so viewport coordinates and
     viewBox coordinates stay 1:1 — the brush math depends on it. */
  height: 96px;
  cursor: crosshair;
  user-select: none;
  touch-action: none;
}

.sparkline-svg.dragging {
  cursor: ew-resize;
}

.baseline {
  stroke: color-mix(in srgb, var(--text-faint) 40%, transparent);
  stroke-width: 0.5;
}

.sparkline-bar {
  transition: opacity 140ms ease;
}

.sparkline-bar:hover {
  opacity: 0.8;
}

.sparkline-bar.empty {
  fill: var(--sparkline-empty);
}

.selection-band {
  fill: color-mix(in srgb, var(--accent) 18%, transparent);
  stroke: var(--accent);
  stroke-width: 1;
}

.selection-band.live {
  fill: color-mix(in srgb, var(--accent) 28%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .sparkline-bar,
  .sparkline-bar:hover {
    transition: none;
  }
}
</style>

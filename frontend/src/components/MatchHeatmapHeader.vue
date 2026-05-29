<script setup lang="ts">
import { computed, toRef } from 'vue'
import type { MatchRecord } from '../api'
import { useMatchHeatmap } from '../composables/useMatchHeatmap'

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

function cellFill(cell: { winRate: number; total: number; empty: boolean }): string {
  if (cell.empty) return 'var(--heatmap-empty)'
  const wrPct = Math.round(cell.winRate * 100)
  const sat = Math.round(20 + Math.min(1, cell.total / Math.max(model.value.maxTotal, 1)) * 80)
  return `color-mix(in srgb, color-mix(in srgb, var(--win) ${wrPct}%, var(--loss)) ${sat}%, var(--heatmap-empty))`
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

function isActive(cell: { date: string }): boolean {
  const range = activeRange.value
  if (!range) return false
  return cell.date >= range.from && cell.date <= range.to
}

function onCellClick(cell: { date: string; empty: boolean }) {
  if (cell.empty) return
  const range = activeRange.value
  // Toggle off only when the user clicks the *same* single-day pick
  // that's already active. Clicking inside a multi-day brush range
  // narrows that range to the clicked day rather than clearing —
  // the brush is the "set a range" affordance, the click is the
  // "set a day" affordance.
  if (range && range.from === range.to && range.from === cell.date) {
    emit('update:filter-from', '')
    emit('update:filter-to', '')
    return
  }
  emit('update:filter-from', `${cell.date}T00:00`)
  emit('update:filter-to',   `${cell.date}T23:59`)
}
</script>

<template>
  <div
    class="match-heatmap"
    role="grid"
    :aria-label="`Match calendar — ${model.start} to ${model.end}`"
  >
    <svg
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
          @click="onCellClick(cell)"
          @keydown.enter.prevent="onCellClick(cell)"
          @keydown.space.prevent="onCellClick(cell)"
        />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.match-heatmap {
  --heatmap-empty: color-mix(in srgb, var(--surface-2) 92%, var(--border));

  flex: 0 0 auto;
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

.heatmap-cell.active {
  stroke: var(--accent);
  stroke-width: 1.8;
  filter: drop-shadow(0 0 4px var(--accent-glow, color-mix(in srgb, var(--accent) 45%, transparent)));
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

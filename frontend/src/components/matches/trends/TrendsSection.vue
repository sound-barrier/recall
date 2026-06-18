<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'

import { useDossier } from '@/composables/dashboard/useDossier'
import { useDragReorder } from '@/composables/dashboard/useDragReorder'
import { useNarrow } from '@/composables/matches/useNarrow'
import { useTrendsLayout, type TrendChartId } from '@/composables/matches/useTrendsLayout'
import type { TrendOption } from '@/components/matches/trends/echarts'
import { rankLadderOption, winrateOption, lineOption, rankDeltaOption } from '@/components/matches/trends/trend-options'

// ECharts is heavy; defer it to its own chunk that only loads when the
// user opens the section (the v-if below gates the mount).
const TrendChart = defineAsyncComponent(() => import('@/components/matches/trends/TrendChart.vue'))

// Open a match's detail panel when a chart point is clicked — forwarded
// up to App.vue's selection.open (same path as a leaf-row click).
const emit = defineEmits<{ 'open-match': [matchKey: string] }>()

// Time-series come from the dossier, so the charts track the same
// narrowed set as the rest of the workspace.
const dossier = useDossier()

// Brushing a time range on a chart sets the narrow's custom date range —
// the same field the Campaign Log sparkline drives — so the whole
// workspace (list + dossier + charts) scopes to the selection.
const narrow = useNarrow()
function onNarrowRange(from: string, to: string): void {
  narrow.customFrom.value = from
  narrow.customTo.value = to
  narrow.pickedRange.value = 'custom'
}

const { visibleIds, hiddenIds, hide, show, move } = useTrendsLayout()

// Drag/keyboard reorder of the visible charts. One logical row — the
// 2-col grid just wraps the linear order — so ArrowLeft/Right + Home/End
// reorder and Up/Down are no-ops (adjacentRow returns null). Only the ⠿
// grip is draggable; the card body stays free for the canvas brush.
const { dragging, dropHint, onDragStart, onDragEnd, onDragOver, onDrop, onRowDragOver, onRowDrop, onHandleKeydown } =
  useDragReorder({
    onMove: (_id, _fromRow, fromIdx, _toRow, toIdx) => move(fromIdx, toIdx),
    rowSize: () => visibleIds.value.length,
    adjacentRow: () => null,
  })

function onGripDragStart(id: TrendChartId, idx: number, e: DragEvent): void {
  onDragStart(id, 0, idx, e)
  // Drag the whole card, not the tiny grip glyph.
  const card = (e.currentTarget as HTMLElement).closest('.trend-card')
  if (card instanceof HTMLElement && e.dataTransfer) e.dataTransfer.setDragImage(card, 24, 16)
}

const expanded = ref(false)
const windowSize = ref<number>(20)

// Bumped to tell every chart to reset its zoom; "Reset view" also clears
// the brushed date range so the user can get back to the full picture.
const resetSignal = ref(0)
function resetView(): void {
  resetSignal.value++
  narrow.customFrom.value = ''
  narrow.customTo.value = ''
  narrow.pickedRange.value = 'all'
}

const rankSeries = dossier.rankLadder
const winrateSeries = dossier.rollingWinrate(windowSize)
const rankDeltaSeries = dossier.rankDelta
const cumulativeNetSeries = dossier.cumulativeNet
const modifierFreqSeries = dossier.modifierFrequency

const someData = (series: { points: unknown[] }[]) => series.some((s) => s.points.length > 0)

interface ChartCard {
  id: TrendChartId
  title: string
  caption: string
  option: TrendOption
  hasData: boolean
  empty: string
  windowSelector: boolean
}

const cardsById = computed<Record<TrendChartId, ChartCard>>(() => ({
  'rank-ladder': {
    id: 'rank-ladder', title: 'Rank over time', windowSelector: false,
    caption: 'Rank progression over time, by role', option: rankLadderOption(rankSeries.value), hasData: someData(rankSeries.value),
    empty: 'No rank readings — capture a competitive rank screenshot to track your climb.',
  },
  'rolling-winrate': {
    id: 'rolling-winrate', title: 'Rolling win-rate (%)', windowSelector: true,
    caption: `Rolling win rate over the last ${windowSize.value} matches, by role`, option: winrateOption(winrateSeries.value), hasData: someData(winrateSeries.value),
    empty: 'No decisive matches in the set.',
  },
  'rank-delta': {
    id: 'rank-delta', title: 'Rank delta per match', windowSelector: false,
    caption: 'Per-match rank change, by role', option: rankDeltaOption(rankDeltaSeries.value), hasData: someData(rankDeltaSeries.value),
    empty: 'No rank readings — capture a competitive rank screenshot.',
  },
  'cumulative-net': {
    id: 'cumulative-net', title: 'Cumulative net record', windowSelector: false,
    caption: 'Running wins minus losses over time, by role', option: lineOption(cumulativeNetSeries.value), hasData: someData(cumulativeNetSeries.value),
    empty: 'No decisive matches in the set.',
  },
  'modifiers': {
    id: 'modifiers', title: 'Modifiers over time', windowSelector: false,
    caption: 'Cumulative count of each match modifier over time', option: lineOption(modifierFreqSeries.value), hasData: someData(modifierFreqSeries.value),
    empty: 'No modifiers recorded — they come from competitive rank screenshots.',
  },
}))

const visibleCards = computed(() => visibleIds.value.map((id) => cardsById.value[id]))
const hiddenCards = computed(() => hiddenIds.value.map((id) => cardsById.value[id]))
const anyData = computed(() => Object.values(cardsById.value).some((c) => c.hasData))

const WINDOW_OPTIONS = [10, 20, 50] as const
</script>

<template>
  <section class="trends-section" aria-label="Trends">
    <div class="trends-header">
      <button
        class="trends-toggle"
        :aria-expanded="expanded"
        :aria-controls="expanded ? 'trends-body' : undefined"
        @click="expanded = !expanded"
      >
        <span class="chev" :class="{ open: expanded }" aria-hidden="true">▸</span>
        <span class="trends-title">Trends</span>
        <span class="trends-hint">Rank, win-rate &amp; modifiers over time, by role</span>
      </button>
      <button
        v-if="expanded"
        type="button"
        class="trends-reset"
        title="Reset chart zoom and clear the brushed date range"
        @click="resetView"
      >
        Reset view
      </button>
    </div>

    <div v-if="expanded" id="trends-body" class="trends-body">
      <p v-if="!anyData" class="trends-empty">
        No matches with a known date in this set. Trends chart matches with a date and time —
        narrow to a range that includes timestamped matches.
      </p>

      <template v-else>
        <p v-if="!visibleCards.length" class="trends-empty">
          All charts hidden — add one below.
        </p>
        <div
          v-else
          class="trends-grid"
          @dragover="onRowDragOver(0, $event)"
          @drop="onRowDrop(0, $event)"
        >
          <div
            v-for="(card, idx) in visibleCards"
            :key="card.id"
            class="trend-card"
            :data-trend-card="card.id"
            :class="{
              'trend-card-drop-target': dropHint?.idx === idx,
              'trend-card-dragging': dragging?.idx === idx,
            }"
            @dragover="onDragOver(0, idx, $event)"
            @drop="onDrop(0, idx, $event)"
          >
            <div class="trend-card-head">
              <div class="trend-card-lead">
                <button
                  type="button"
                  class="trend-card-grip"
                  draggable="true"
                  :aria-label="`Reorder the ${card.title} chart. Use arrow keys to move it.`"
                  :data-drag-handle="card.id"
                  @click.stop
                  @dragstart="onGripDragStart(card.id, idx, $event)"
                  @dragend="onDragEnd"
                  @keydown="onHandleKeydown(card.id, 0, idx, $event)"
                >
                  <span aria-hidden="true">⠿</span>
                </button>
                <h4 class="trend-card-title">
                  {{ card.title }}
                </h4>
              </div>
              <div class="trend-card-actions">
                <select
                  v-if="card.windowSelector"
                  v-model.number="windowSize"
                  class="trend-window-select"
                  aria-label="Win-rate window"
                >
                  <option v-for="size in WINDOW_OPTIONS" :key="size" :value="size">
                    last {{ size }}
                  </option>
                </select>
                <button
                  type="button"
                  class="trend-card-close"
                  :aria-label="`Remove the ${card.title} chart`"
                  :title="`Remove the ${card.title} chart`"
                  @click="hide(card.id)"
                >
                  ×
                </button>
              </div>
            </div>
            <TrendChart
              v-if="card.hasData"
              :option="card.option"
              :caption="card.caption"
              :reset-signal="resetSignal"
              @open-match="(k) => emit('open-match', k)"
              @narrow-range="onNarrowRange"
            />
            <p v-else class="trend-card-empty">
              {{ card.empty }}
            </p>
          </div>
        </div>

        <div v-if="hiddenCards.length" class="trends-add">
          <span class="trends-add-label">Add chart:</span>
          <button
            v-for="card in hiddenCards"
            :key="card.id"
            type="button"
            class="trends-add-chip"
            @click="show(card.id)"
          >
            + {{ card.title }}
          </button>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.trends-section {
  margin-top: 1rem;
  border-top: 1px solid var(--border);
  padding-top: 0.5rem;
}

.trends-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.trends-toggle {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex: 1;
  padding: 0.35rem 0.25rem;
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.trends-title {
  font-size: 1rem;
  font-weight: 600;
}

.trends-hint {
  color: var(--text-dim);
  font-size: 0.8rem;
}

.trends-reset {
  flex-shrink: 0;
  background: var(--surface-2);
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.2rem 0.55rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.trends-reset:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.trends-body {
  margin-top: 0.75rem;
}

.trends-empty,
.trend-card-empty {
  color: var(--text-dim);
  font-size: 0.85rem;
  margin: 0;
}

.trends-empty {
  padding: 1.5rem 0.5rem;
}

.trends-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

@media (width <= 720px) {
  .trends-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.trend-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.75rem;
  min-width: 0;
  transition: box-shadow 140ms ease, opacity 140ms ease;
}

/* The card being dragged dims; the card it will land in front of gets an
   inset accent ring (active-drag feedback, not a resting hover). */
.trend-card-dragging {
  opacity: 0.4;
}

.trend-card-drop-target {
  box-shadow: inset 0 0 0 2px var(--accent);
}

.trend-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.trend-card-lead {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.trend-card-grip {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 0.72rem;
  line-height: 1;
  padding: 0 0.15rem;
  cursor: grab;
}

.trend-card-grip:active {
  cursor: grabbing;
}

.trend-card-grip:hover {
  color: var(--text);
}

.trend-card-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text);
}

.trend-card-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.trend-window-select {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.15rem 0.4rem;
  font-size: 0.8rem;
}

.trend-card-close {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 1.1rem;
  line-height: 1;
  padding: 0 0.2rem;
  cursor: pointer;
}

.trend-card-close:hover {
  color: var(--loss);
}

.trend-card-empty {
  padding: 2rem 0.5rem;
  text-align: center;
}

.trends-add {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.85rem;
}

.trends-add-label {
  color: var(--text-dim);
  font-size: 0.8rem;
}

.trends-add-chip {
  background: var(--surface-2);
  color: var(--text-dim);
  border: 1px dashed var(--border-strong);
  border-radius: 999px;
  padding: 0.18rem 0.6rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.trends-add-chip:hover {
  color: var(--text);
  border-color: var(--accent);
}
</style>

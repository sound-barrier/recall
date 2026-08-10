<script setup lang="ts">
import { computed, defineAsyncComponent, reactive, ref } from 'vue'

import { useTheme } from '@/composables/settings/useTheme'
import { useDossier } from '@/composables/dashboard/useDossier'
import { useDragReorder } from '@/composables/dashboard/useDragReorder'
import { useNarrow } from '@/composables/matches/useNarrow'
import { useTrendsLayout, type TrendChartId } from '@/composables/matches/useTrendsLayout'
import type { TrendOption } from '@/components/matches/trends/echarts'
import { rankLadderOption, winrateOption, lineOption, rankDeltaOption, heatmapOption } from '@/components/matches/trends/trend-options'

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
  // Viz picks are whole-day: drop any panel-set minute bounds.
  narrow.customFromTime.value = ''
  narrow.customToTime.value = ''
  narrow.pickedRange.value = 'custom'
}

const { visibleIds, hiddenIds, hide, show, move } = useTrendsLayout()

// Drag/keyboard reorder of the visible charts. One logical row — the
// 2-col grid just wraps the linear order — so ArrowLeft/Right + Home/End
// reorder and Up/Down are no-ops (adjacentRow returns null). Only the ⠿
// grip is draggable; the card body stays free for the canvas brush.
const { dragging, dropHint, onDragStart, onDragEnd, onDragOver, onDrop, onRowDragOver, onRowDrop, onHandleKeydown } =
  useDragReorder({
    onMove: (_id, from, to) => move(from.idx, to.idx),
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

// "Reset view" is enabled only when there's something to reset: a chart's
// zoom slider is off the full range, or a custom (brushed) date range is
// active. Otherwise the button would be a no-op and read as broken.
const zoomedCharts = reactive(new Set<TrendChartId>())
const canReset = computed(() => zoomedCharts.size > 0 || narrow.pickedRange.value === 'custom')
function onZoomChange(id: TrendChartId, zoomed: boolean): void {
  if (zoomed) zoomedCharts.add(id)
  else zoomedCharts.delete(id)
}
function resetView(): void {
  resetSignal.value++
  zoomedCharts.clear()
  narrow.customFrom.value = ''
  narrow.customTo.value = ''
  narrow.customFromTime.value = ''
  narrow.customToTime.value = ''
  narrow.pickedRange.value = 'all'
}

const rankSeries = dossier.rankLadder
const winrateSeries = dossier.rollingWinrate(windowSize)
const heroWinrateSeries = dossier.heroRollingWinrate(windowSize)
const mapWinrateSeries = dossier.mapRollingWinrate(windowSize)
const rankDeltaSeries = dossier.rankDelta
const cumulativeNetSeries = dossier.cumulativeNet
const modifierFreqSeries = dossier.modifierFrequency
const combatStatsSeries = dossier.combat
const bestTimesGrid = dossier.dayTimeWinrate({ bucketCount: 6 })

const someData = (series: { points: unknown[] }[]) => series.some((s) => s.points.length > 0)

interface ChartCard {
  id: TrendChartId
  title: string
  caption: string
  option: TrendOption
  hasData: boolean
  empty: string
  // Static (heatmap) cards opt out of the timeline brush/zoom/click.
  interactive?: boolean
}

const { themeMode } = useTheme()

const cardsById = computed<Record<TrendChartId, ChartCard>>(() => {
  // Series colors are resolved from palette tokens when the option is
  // BUILT (see trend-options' SERIES_TOKEN), so this computed has to
  // re-run on a theme switch. Without the dependency, TrendChart
  // re-registers its ECharts theme — repainting axes, grid and tooltip —
  // while the series keep the outgoing theme's hues.
  void themeMode.value

  return ({
  'rank-ladder': {
    id: 'rank-ladder', title: 'Rank over time',
    caption: 'Rank progression over time, by role', option: rankLadderOption(rankSeries.value), hasData: someData(rankSeries.value),
    empty: 'No rank readings — capture a competitive rank screenshot to track your climb.',
  },
  'rolling-winrate': {
    id: 'rolling-winrate', title: 'Rolling win-rate (%)',
    caption: `Rolling win rate over the last ${windowSize.value} matches, by role`, option: winrateOption(winrateSeries.value), hasData: someData(winrateSeries.value),
    empty: 'No decisive matches in the set.',
  },
  'hero-winrate': {
    id: 'hero-winrate', title: 'Win-rate by hero',
    caption: `Rolling win rate over the last ${windowSize.value} matches, per most-played hero`, option: winrateOption(heroWinrateSeries.value), hasData: someData(heroWinrateSeries.value),
    empty: 'No decisive matches for any hero — nothing to chart yet.',
  },
  'map-winrate': {
    id: 'map-winrate', title: 'Win-rate by map',
    caption: `Rolling win rate over the last ${windowSize.value} matches, per most-played map`, option: winrateOption(mapWinrateSeries.value), hasData: someData(mapWinrateSeries.value),
    empty: 'No decisive matches on any map — nothing to chart yet.',
  },
  'combat': {
    id: 'combat', title: 'Combat per 10 min',
    caption: 'Eliminations, deaths, and assists per 10 minutes over time', option: lineOption(combatStatsSeries.value), hasData: someData(combatStatsSeries.value),
    empty: 'No combat stats parsed — they come from a scoreboard screenshot, not the rank screen.',
  },
  'rank-delta': {
    id: 'rank-delta', title: 'Rank delta per match',
    caption: 'Per-match rank change, by role', option: rankDeltaOption(rankDeltaSeries.value), hasData: someData(rankDeltaSeries.value),
    empty: 'No rank readings — capture a competitive rank screenshot.',
  },
  'cumulative-net': {
    id: 'cumulative-net', title: 'Cumulative net record',
    caption: 'Running wins minus losses over time, by role', option: lineOption(cumulativeNetSeries.value, { area: true }), hasData: someData(cumulativeNetSeries.value),
    empty: 'No decisive matches in the set.',
  },
  'modifiers': {
    id: 'modifiers', title: 'Modifiers over time',
    caption: 'Cumulative count of each match modifier over time', option: lineOption(modifierFreqSeries.value), hasData: someData(modifierFreqSeries.value),
    empty: 'No modifiers recorded — they come from competitive rank screenshots.',
  },
  'best-times': {
    id: 'best-times', title: 'Best times to play', interactive: false,
    caption: 'Win rate by day of week and time of day', option: heatmapOption(bestTimesGrid.value), hasData: bestTimesGrid.value.cells.length > 0,
    empty: 'No decisive matches with a known date and time — nothing to chart yet.',
  },
  })
})

const visibleCards = computed(() => visibleIds.value.map((id) => cardsById.value[id]))
const hiddenCards = computed(() => hiddenIds.value.map((id) => cardsById.value[id]))
const anyData = computed(() => Object.values(cardsById.value).some((c) => c.hasData))

const WINDOW_OPTIONS = [10, 20, 50] as const

// The rolling-window selector drives every rolling win-rate chart, so it lives
// in the section toolbar (not on one card). Show it only when at least one of
// those charts is visible.
const WINDOWED_IDS: readonly TrendChartId[] = ['rolling-winrate', 'hero-winrate', 'map-winrate']
const showWindowSelector = computed(() => visibleIds.value.some((id) => WINDOWED_IDS.includes(id)))
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
      <label v-if="expanded && showWindowSelector" class="trends-window">
        <span class="trends-window-label">Rolling window</span>
        <select v-model.number="windowSize" class="trend-window-select">
          <option v-for="size in WINDOW_OPTIONS" :key="size" :value="size">
            last {{ size }}
          </option>
        </select>
      </label>
      <button
        v-if="expanded"
        type="button"
        class="trends-reset"
        :disabled="!canReset"
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
              :interactive="card.interactive"
              @open-match="(k) => emit('open-match', k)"
              @narrow-range="onNarrowRange"
              @zoom-change="(z) => onZoomChange(card.id, z)"
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

<style scoped src="./trends-section.css"></style>

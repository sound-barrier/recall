<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import VChart from 'vue-echarts'
import { registerTheme } from 'echarts/core'

import '@/components/matches/trends/echarts'
import type { TrendOption } from '@/components/matches/trends/echarts'
import { useTheme } from '@/composables/settings/useTheme'

// Wraps vue-echarts with the cross-cutting concerns every trend chart
// needs: app-theme colours (canvas can't inherit CSS, so we read the
// custom properties and register a matching ECharts theme, rebuilt on
// every theme switch), a screen-reader label (the canvas is opaque to
// AT), motion that respects prefers-reduced-motion, and the shared
// interactions — click a point to open its match, drag to brush a time
// range (emitted up to narrow the set), wheel/slider to zoom.
const props = defineProps<{
  option: TrendOption
  caption: string
  // Bumped by the parent's "Reset view" button to reset this chart's zoom.
  resetSignal?: number
}>()

const emit = defineEmits<{
  'open-match': [matchKey: string]
  'narrow-range': [from: string, to: string]
}>()

const { themeMode } = useTheme()

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

// A unique theme name per mode so vue-echarts re-inits the chart when
// the palette changes (it only re-applies the theme prop on a new
// value, not a mutated registration).
const themeName = ref(`recall-${themeMode.value}`)

function registerThemeFromCss(): void {
  const text = cssVar('--text', '#ecedf0')
  const textDim = cssVar('--text-dim', '#9ca0ac')
  const border = cssVar('--border', '#2c2f38')
  const surface = cssVar('--surface-2', '#181b22')
  const axis = {
    axisLine: { lineStyle: { color: border } },
    axisTick: { lineStyle: { color: border } },
    axisLabel: { color: textDim },
    splitLine: { lineStyle: { color: border, opacity: 0.5 } },
  }
  const name = `recall-${themeMode.value}`
  registerTheme(name, {
    color: [
      cssVar('--accent', '#F5A623'),
      cssVar('--win', '#4dff8e'),
      cssVar('--loss', '#ff5a73'),
      cssVar('--draw', '#ffc94d'),
      '#5cc8ff',
      '#b98cff',
      '#ff9d5c',
      '#5ce1c0',
    ],
    backgroundColor: 'transparent',
    textStyle: { color: textDim },
    title: { textStyle: { color: text } },
    categoryAxis: axis,
    valueAxis: axis,
    timeAxis: axis,
    logAxis: axis,
    legend: { textStyle: { color: textDim } },
    tooltip: { backgroundColor: surface, borderColor: border, textStyle: { color: text } },
    line: { lineStyle: { width: 2 } },
  })
  themeName.value = name
}

const reduceMotion = ref(false)
let motionQuery: MediaQueryList | null = null
function syncMotion(): void {
  reduceMotion.value = motionQuery?.matches ?? false
}

// Animation is the only prop fed through the option itself; colours go
// via the registered theme, the label via ECharts' native aria block.
const themedOption = computed<TrendOption>(() => ({
  animation: !reduceMotion.value,
  aria: { enabled: true, label: { description: props.caption } },
  ...props.option,
}))

registerThemeFromCss()
watch(themeMode, registerThemeFromCss)

// ─── Interactions ──────────────────────────────────────────────
const chart = ref<InstanceType<typeof VChart> | null>(null)

// Arm an always-on lineX brush (no toolbox button) so a drag selects a
// range. The chart re-inits on theme / option change, which resets the
// global cursor, so re-arm after each.
function enableBrush(): void {
  chart.value?.dispatchAction?.({
    type: 'takeGlobalCursor',
    key: 'brush',
    brushOption: { brushType: 'lineX', brushMode: 'single' },
  })
}

// Format an epoch ms to the `YYYY-MM-DDTHH:MM` shape the narrow's
// customFrom/customTo expect.
function epochToLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// The match_key nearest a given epoch across every plotted series — used
// to turn a click (a near-zero brush span) into "open that match".
interface ChartPoint { value?: [number, number]; matchKey?: string }
function nearestMatchKey(t: number): string | undefined {
  const series = props.option.series
  const list = (Array.isArray(series) ? series : series ? [series] : []) as unknown as { data?: ChartPoint[] }[]
  let best: { d: number; key: string } | undefined
  for (const s of list) {
    for (const item of s.data ?? []) {
      if (!Array.isArray(item?.value) || !item.matchKey) continue
      const d = Math.abs(item.value[0] - t)
      if (!best || d < best.d) best = { d, key: item.matchKey }
    }
  }
  return best?.key
}

// A drag brushes a range → narrow the set to it. (A plain click doesn't
// fire brushEnd; it's handled by the pointer tracking below, because the
// always-on brush cursor swallows ECharts' own @click.)
function onBrushEnd(params: unknown): void {
  const range = (params as { areas?: { coordRange?: [number, number] }[] }).areas?.[0]?.coordRange
  if (!range || range.length !== 2) return
  const from = Math.min(range[0], range[1])
  const to = Math.max(range[0], range[1])
  if (to - from < 60_000) return
  emit('narrow-range', epochToLocalInput(from), epochToLocalInput(to))
  // Clear the selection rectangle — the re-narrow makes it stale.
  chart.value?.dispatchAction?.({ type: 'brush', areas: [] })
}

// Click-to-open: track pointer down→up at the DOM level (the brush eats
// ECharts' @click). A near-stationary release is a click → map its pixel
// to a time via convertFromPixel and open the nearest match; a drag is
// left to the brush.
let downX = 0
let downY = 0
function onPointerDown(e: PointerEvent): void {
  downX = e.clientX
  downY = e.clientY
}
function onPointerUp(e: PointerEvent): void {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return
  const inst = chart.value
  if (!inst?.convertFromPixel || !inst.containPixel) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const px: [number, number] = [e.clientX - rect.left, e.clientY - rect.top]
  // Only clicks inside the plot grid open a match — a click on the legend
  // (which toggles the line) or the zoom slider must not.
  if (!inst.containPixel({ gridIndex: 0 }, px)) return
  const coord = inst.convertFromPixel({ gridIndex: 0 }, px) as number[]
  const t = Array.isArray(coord) ? coord[0] : undefined
  if (typeof t !== 'number') return
  const key = nearestMatchKey(t)
  if (key) emit('open-match', key)
}

onMounted(() => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    syncMotion()
    motionQuery.addEventListener('change', syncMotion)
  }
  void nextTick(enableBrush)
})
watch(themedOption, () => nextTick(enableBrush))
// Parent "Reset view" → snap the zoom window back to the full range.
watch(() => props.resetSignal, () => {
  chart.value?.dispatchAction?.({ type: 'dataZoom', start: 0, end: 100 })
})
onBeforeUnmount(() => motionQuery?.removeEventListener('change', syncMotion))
</script>

<template>
  <div
    class="trend-chart"
    role="img"
    :aria-label="caption"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
  >
    <VChart
      ref="chart"
      class="trend-chart-canvas"
      :option="themedOption"
      :theme="themeName"
      autoresize
      @brush-end="onBrushEnd"
    />
  </div>
</template>

<style scoped>
.trend-chart {
  width: 100%;
  height: 260px;
}

.trend-chart-canvas {
  width: 100%;
  height: 100%;
}
</style>

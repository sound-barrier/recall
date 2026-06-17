<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import VChart from 'vue-echarts'
import { registerTheme } from 'echarts/core'

import '@/components/matches/trends/echarts'
import type { TrendOption } from '@/components/matches/trends/echarts'
import { useTheme } from '@/composables/settings/useTheme'

// Wraps vue-echarts with the three cross-cutting concerns every trend
// chart needs: app-theme colours (canvas can't inherit CSS, so we read
// the custom properties and register a matching ECharts theme, rebuilt
// on every theme switch), a screen-reader label (the canvas is opaque
// to AT), and motion that respects prefers-reduced-motion.
const props = defineProps<{
  option: TrendOption
  caption: string
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

onMounted(() => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    syncMotion()
    motionQuery.addEventListener('change', syncMotion)
  }
})
onBeforeUnmount(() => motionQuery?.removeEventListener('change', syncMotion))
</script>

<template>
  <div class="trend-chart" role="img" :aria-label="caption">
    <VChart class="trend-chart-canvas" :option="themedOption" :theme="themeName" autoresize />
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

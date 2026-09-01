<script setup lang="ts">
// Are you improving on Juno, regressing on Ana?
//
// A win rate per hero is a single number and hides its own direction: 55% can
// be a climb or a slide. This is the rolling line beside each hero's name, so
// the SHAPE is the answer and the number is the caption.
//
// The line carries its own text equivalent (WCAG 1.1.1) — a chart whose label
// is only its name tells a screen reader nothing about what it shows.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { heroTrendSchema, type HeroTrendConfig } from '@/dashboard/widget-schemas'
import { heroRollingWinrateSeries } from '@/match/trends/match-trends-helpers'
import { sparkAria, sparkPoints } from '@/match/trends/spark-line'

const BOX = { w: 120, h: 24 }

const dossier = useDossier()
const { config } = useWidgetConfig<HeroTrendConfig>('hero-trend-lines', heroTrendSchema)

const series = computed(() =>
  heroRollingWinrateSeries(dossier.records.value, config.value.window, config.value.limit))

const rows = computed(() => series.value.map((s) => {
  const values = s.points.map((p) => p.v)
  return {
    name: s.name,
    values,
    points: sparkPoints(values, BOX),
    latest: values.length > 0 ? Math.round(values[values.length - 1]!) : null,
    aria: sparkAria(values.map(Math.round), s.name),
  }
}))
</script>

<template>
  <header class="breakdown-head">
    <span class="eyebrow accent breakdown-eyebrow">Hero trend lines</span>
  </header>
  <p v-if="rows.length === 0" class="kpi-sub">
    Not enough decisive games on any hero yet.
  </p>
  <ul v-else class="hero-trend-list">
    <li v-for="row in rows" :key="row.name" class="hero-trend-row">
      <span class="bd-name">{{ row.name }}</span>
      <svg
        class="hero-trend-spark"
        :viewBox="`0 0 ${BOX.w} ${BOX.h}`"
        role="img"
        :aria-label="row.aria"
        preserveAspectRatio="none"
      >
        <polyline :points="row.points" fill="none" />
      </svg>
      <span class="bd-stats">{{ row.latest === null ? '—' : `${row.latest}%` }}</span>
    </li>
  </ul>
</template>

<style scoped>
.hero-trend-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* The line is the content; it takes the room the name and the number leave. */
.hero-trend-spark {
  flex: 1;
  min-width: 0;
  height: 1.5rem;
}

.hero-trend-spark polyline {
  stroke: var(--accent);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
</style>

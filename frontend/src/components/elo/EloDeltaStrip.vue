<script setup lang="ts">
import { computed } from 'vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { fmtProb } from '@/components/elo/elo-format'

// "Your edits, priced" — the measured → edited comparison that makes every
// dial turn legible: expected games, pace, and season odds, side by side
// with what the seed measured. Renders only while something is edited and
// both sides are computable.
const {
  isEdited, naive, weeksNaive, probThisSeason,
  measuredNaive, measuredWeeks, measuredProbSeason,
} = useEloCalc()

const games = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return '—'
  if (v === 0) return 'there'
  return `~${Math.ceil(v)}`
}
const weeks = (v: number | null): string => {
  if (v === null) return '—'
  return `${v < 10 ? Math.round(v * 10) / 10 : Math.round(v)}w`
}

const rows = computed(() => {
  if (!isEdited.value || measuredNaive.value === null || naive.value === null) return null
  const out = [{
    label: 'expected games',
    from: games(measuredNaive.value.expectedGames),
    to: games(naive.value.expectedGames),
  }]
  if (measuredWeeks.value !== null && weeksNaive.value !== null) {
    out.push({ label: 'at your pace', from: weeks(measuredWeeks.value), to: weeks(weeksNaive.value) })
  }
  if (measuredProbSeason.value !== null && probThisSeason.value !== null) {
    out.push({ label: 'this season', from: fmtProb(measuredProbSeason.value), to: fmtProb(probThisSeason.value) })
  }
  return out
})
</script>

<template>
  <div v-if="rows" class="elo-delta-strip" data-elo-delta-strip role="status">
    <p class="elo-delta-title">
      Your edits, priced
    </p>
    <dl class="elo-delta-rows">
      <div v-for="r in rows" :key="r.label" class="elo-delta-row">
        <dt>{{ r.label }}</dt>
        <dd>{{ r.from }} → {{ r.to }}</dd>
      </div>
    </dl>
    <p class="elo-delta-foot">
      vs your measured numbers
    </p>
  </div>
</template>

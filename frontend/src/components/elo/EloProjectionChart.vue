<script setup lang="ts">
import { computed } from 'vue'
import TrendChart from '@/components/matches/trends/TrendChart.vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { useTheme } from '@/composables/settings/useTheme'
import { buildEloProjectionOption } from '@/components/elo/elo-chart-options'
import { fmtRank } from '@/components/elo/elo-format'

// Games (X) vs rank ladder (Y): the two futures, a shaded luck band around the
// optimistic line, a dashed target line, and — when the target is above your
// current ceiling — a dotted marker at the plateau. Static: no brush/zoom/click
// (those assume a time axis + match keys).
const { curves, decay, targetScore, targetTier, targetDivision, seasonSim, ceiling } = useEloCalc()

const targetLabel = computed(() => fmtRank(targetTier.value, targetDivision.value))
const { themeMode } = useTheme()

const option = computed(() => {
  // Series colours resolve from palette tokens at build time, so the
  // option must be rebuilt on a theme switch — see elo-chart-options.
  void themeMode.value
  if (!curves.value || targetScore.value === null) return null
  const capped = decay.value && decay.value.requiredWinRate !== null
  const band = ceiling.value
  return buildEloProjectionOption(curves.value, {
    targetScore: targetScore.value,
    targetLabel: targetLabel.value,
    ...(capped ? { ceilingScore: decay.value!.impliedTrueScore } : {}),
    ...(capped && band !== null && band.hi !== null ? { ceilingBand: { lo: band.lo, hi: band.hi } } : {}),
    ...(seasonSim.value ? { fan: seasonSim.value.fan } : {}),
  })
})

const caption = computed(() => {
  const base = `Two futures on the way to ${targetLabel.value}: if your wins hold (blue) vs as opponents get tougher (amber). The shaded band is how much luck can swing it.`
  const sim = seasonSim.value
  const withSim = sim
    ? `${base} The gray fan is the middle 80% of ${sim.sims.toLocaleString()} simulated seasons replaying your real rank-card moves.`
    : base
  const capped = decay.value && decay.value.requiredWinRate !== null
  return capped && ceiling.value !== null && ceiling.value.hi !== null
    ? `${withSim} The ceiling is shown as a range — it narrows as your sample grows.`
    : withSim
})
</script>

<template>
  <figure v-if="option" class="elo-chart" data-elo-chart>
    <TrendChart :option="option" :caption="caption" :interactive="false" />
    <figcaption class="elo-chart-cap" data-elo-chart-caption>
      {{ caption }}
    </figcaption>
  </figure>
</template>

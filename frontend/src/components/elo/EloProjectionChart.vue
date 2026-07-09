<script setup lang="ts">
import { computed } from 'vue'
import TrendChart from '@/components/matches/trends/TrendChart.vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { buildEloProjectionOption } from '@/components/elo/elo-chart-options'
import { fmtRank } from '@/components/elo/elo-format'

// Games (X) vs rank ladder (Y): the two futures, a shaded luck band around the
// optimistic line, a dashed target line, and — when the target is above your
// current ceiling — a dotted marker at the plateau. Static: no brush/zoom/click
// (those assume a time axis + match keys).
const { curves, decay, targetScore, targetTier, targetDivision } = useEloCalc()

const targetLabel = computed(() => fmtRank(targetTier.value, targetDivision.value))

const option = computed(() => {
  if (!curves.value || targetScore.value === null) return null
  const capped = decay.value && decay.value.requiredWinRate !== null
  return buildEloProjectionOption(curves.value, {
    targetScore: targetScore.value,
    targetLabel: targetLabel.value,
    ...(capped ? { ceilingScore: decay.value!.impliedTrueScore } : {}),
  })
})

const caption = computed(
  () => `Two futures on the way to ${targetLabel.value}: if your wins hold (blue) vs as opponents get tougher (amber). The shaded band is how much luck can swing it.`,
)
</script>

<template>
  <figure v-if="option" class="elo-chart" data-elo-chart>
    <TrendChart :option="option" :caption="caption" :interactive="false" />
    <figcaption class="elo-chart-cap" data-elo-chart-caption>
      {{ caption }}
    </figcaption>
  </figure>
</template>

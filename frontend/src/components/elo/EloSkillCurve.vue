<script setup lang="ts">
import { computed } from 'vue'
import TrendChart from '@/components/matches/trends/TrendChart.vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { buildSkillCurveOption } from '@/components/elo/elo-chart-options'

// "Your true skill, filtered" — a Kalman smoother treats each rank reading
// as a noisy observation of a slowly-drifting latent skill and draws the
// de-noised curve with its uncertainty band. The variance split is the
// headline: how much of the visible rank movement is real skill drift vs
// matchmaking noise — the sharpest "Elo Hell is mostly variance" number
// the data supports.
const { skillCurve } = useEloCalc()

const option = computed(() => (skillCurve.value ? buildSkillCurveOption(skillCurve.value) : null))

const sharePct = computed(() =>
  skillCurve.value === null ? null : Math.round(skillCurve.value.signalShare * 100))

const shareLine = computed(() => {
  if (sharePct.value === null || skillCurve.value === null) return null
  const noise = 100 - sharePct.value
  const read = sharePct.value < 40
    ? `most of the jitter you feel is the matchmaker, not you`
    : sharePct.value > 70
      ? `your rank is tracking real improvement more than luck`
      : `roughly an even split between real change and queue variance`
  return `Skill drift explains ${sharePct.value}% of your rank movement — the other ${noise}% is matchmaking noise (${skillCurve.value.n} rank readings). In plain terms: ${read}.`
})

const caption = computed(() =>
  `The smoothed line is your estimated true skill over time; the shaded band is its uncertainty. Raw rank readings jump around it — that jumping is the noise share.`)
</script>

<template>
  <section v-if="option && shareLine" class="elo-band" aria-labelledby="elo-skill-title" data-elo-skill>
    <h3 id="elo-skill-title" class="elo-band-title">
      Your true skill, filtered
    </h3>
    <p class="elo-band-sub">
      Every rank reading is a noisy glimpse of a slowly-moving real skill. A Kalman filter separates the two.
    </p>
    <figure class="elo-chart">
      <TrendChart :option="option" :caption="caption" :interactive="false" />
      <figcaption class="elo-chart-cap">
        {{ caption }}
      </figcaption>
    </figure>
    <p class="elo-band-sub elo-skill-share" data-elo-skill-share>
      {{ shareLine }}
    </p>
    <p class="elo-band-sub elo-fine-print">
      Readings are treated as evenly spaced games, not calendar time — a dense session and a week's gap count the same.
    </p>
  </section>
</template>

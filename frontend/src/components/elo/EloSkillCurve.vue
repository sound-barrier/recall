<script setup lang="ts">
import { computed } from 'vue'
import TrendChart from '@/components/matches/trends/TrendChart.vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { useTheme } from '@/composables/settings/useTheme'
import { buildSkillCurveOption } from '@/components/elo/elo-chart-options'
import { fmtPValue } from '@/components/elo/elo-format'

// "Your true skill, filtered" — a Kalman smoother treats each rank reading
// as a noisy observation of a slowly-drifting latent skill and draws the
// de-noised curve with its uncertainty band. The variance split is the
// headline: how much of the visible rank movement is real skill drift vs
// matchmaking noise — the sharpest "Elo Hell is mostly variance" number
// the data supports.
const { skillCurve, changePoint } = useEloCalc()
const { themeMode } = useTheme()

const option = computed(() => {
  // Series colours resolve from palette tokens at build time, so the
  // option must be rebuilt on a theme switch — see elo-chart-options.
  void themeMode.value
  return skillCurve.value
    ? buildSkillCurveOption(skillCurve.value, changePoint.value ? { breakAt: changePoint.value.point.t } : {})
    : null
})

// The dated break, with whatever the app can see changing around it.
// Detection is deliberately conservative: only big, sustained shifts clear
// the honest best-over-all-splits penalty, so this sentence is rare and
// therefore trustworthy.
const shiftLine = computed(() => {
  const cp = changePoint.value
  if (!cp) return null
  const when = new Date(cp.point.t).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
  const { context } = cp
  const correlate = context.reviewStarted
    ? ' — around when you started reviewing games'
    : context.poolEntered.length > 0
      ? ` — around when ${context.poolEntered.join(' and ')} entered your pool`
      : context.poolLeft.length > 0
        ? ` — around when ${context.poolLeft.join(' and ')} left your pool`
        : ''
  return `Your win rate shifted around ${when}: ${cp.point.before.winrate}% → ${cp.point.after.winrate}% (${fmtPValue(cp.point.pValue)})${correlate}. Correlation, not causation — and a long climb sagging toward 50% can read as a downward shift.`
})

const sharePct = computed(() =>
  skillCurve.value === null ? null : Math.round(skillCurve.value.signalShare * 100))

const shareLine = computed(() => {
  if (sharePct.value === null || skillCurve.value === null) return null
  // A clamp-saturated split is an artifact of degenerate moment estimates
  // (e.g. a steady one-way climb), not a measurement — printing "100% skill"
  // off it would be the same overclaim the verdict floor exists to prevent.
  if (skillCurve.value.saturated) {
    return `The skill-vs-noise split isn't measurable yet: these ${skillCurve.value.n} readings don't move in a way the filter can separate, so no percentage would be honest. It needs more varied rank movement.`
  }
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
    <p v-if="shiftLine" class="elo-band-sub elo-skill-share" data-elo-changepoint>
      {{ shiftLine }}
    </p>
    <p class="elo-band-sub elo-fine-print">
      Readings are treated as evenly spaced games, not calendar time — a dense session and a week's gap count the same.
    </p>
  </section>
</template>

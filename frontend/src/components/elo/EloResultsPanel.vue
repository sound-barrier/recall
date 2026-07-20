<script setup lang="ts">
import { computed } from 'vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { fmtGames, fmtGamesRange, fmtRank, fmtScoreRank, fmtWeeks } from '@/components/elo/elo-format'

// The two futures, side by side. The GAP between them is the whole lesson: a
// steady win rate says "grind N games"; tougher opponents say "you level off
// where your form belongs — getting better moves the ceiling". Below them,
// the honest timeline: the same climb as PERCENTILES of a distribution that
// folds the win-rate sample's uncertainty in (Beta posterior × first-passage),
// plus how many more games it takes to actually pin the rate down.
const {
  naive, decay, projInput, sampleN, winRatePct, targetTier, targetDivision,
  weeksNaive, weeksDecay, climbQuantiles, gamesToCertainty,
} = useEloCalc()

const target = computed(() => fmtRank(targetTier.value, targetDivision.value))

// If your wins keep coming — the steady-win-rate future.
const dream = computed(() => {
  const n = naive.value
  if (!n) return null
  if (n.expectedGames === 0) return { head: 'Already there', lines: [] }
  if (!n.reachable) {
    return { head: 'Out of reach', lines: ['Below 50%, extra games slowly cost you rank instead of gaining it.'] }
  }
  const lines = [fmtGamesRange(n.games95, sampleN.value)]
  const weeks = fmtWeeks(weeksNaive.value)
  if (weeks) lines.push(weeks)
  return { head: fmtGames(n.expectedGames), lines }
})

// As opponents get tougher — the regression-to-form future.
const reality = computed(() => {
  const d = decay.value
  if (!d) return null
  const ceiling = fmtScoreRank(d.impliedTrueScore)
  if (d.expectedGames === 0) return { head: 'Already there', lines: [] }
  if (!d.reachable && d.requiredWinRate !== null) {
    return {
      head: `Levels off near ${ceiling}`,
      lines: [
        'Tougher lobbies cap you here at your current form.',
        `To pass ${target.value}, win about ${(d.requiredWinRate * 100).toFixed(1)}%.`,
      ],
    }
  }
  if (!d.reachable) {
    return { head: `Levels off near ${ceiling}`, lines: ['A losing record settles below the target.'] }
  }
  const lines = [`A bit slower, but ${winRatePct.value}% is high enough to break through.`, `Your ceiling right now: ${ceiling}.`]
  const weeks = fmtWeeks(weeksDecay.value)
  if (weeks) lines.push(weeks)
  return { head: fmtGames(d.expectedGames), lines }
})

// Percentiles of the games-to-target distribution, with the never-mass
// (the posterior share at or below the 50% wall) reported honestly.
const timelineLine = computed(() => {
  const q = climbQuantiles.value
  if (!q) return null
  const neverPct = q.pNever >= 0.005 ? Math.round(q.pNever * 100) : null
  if (q.p50 === null) {
    return `At this record, most futures never arrive: a ${neverPct}% chance your true rate sits at or below the 50% wall. Improvement — not more games — moves that.`
  }
  const parts = [`the fastest tenth ~${q.p10} games`, `median ~${q.p50}`]
  if (q.p90 !== null) parts.push(`the slowest tenth ~${q.p90}`)
  const never = neverPct !== null ? ` · a ${neverPct}% chance you never arrive at this form` : ''
  return `Folding your sample size in: ${parts.join(' · ')}${never}.`
})

const knowLine = computed(() => {
  const g = gamesToCertainty.value
  if (g === null) return null
  if (g === 0) return 'Your sample already pins your true win rate within ±3 points.'
  return `Certainty has a price: ≈${g} more decisive games to pin your true win rate within ±3 points.`
})
</script>

<template>
  <div v-if="projInput" class="elo-results">
    <div class="elo-cards">
      <article class="elo-card elo-card-dream" data-elo-card="naive">
        <p class="eyebrow elo-card-eyebrow">
          <span class="elo-card-swatch" aria-hidden="true" />If your wins keep coming
        </p>
        <p v-if="dream" class="elo-card-head">
          {{ dream.head }}
        </p>
        <p v-for="(line, i) in dream?.lines ?? []" :key="i" class="elo-card-line">
          {{ line }}
        </p>
      </article>

      <article class="elo-card elo-card-reality" data-elo-card="decay">
        <p class="eyebrow elo-card-eyebrow">
          <span class="elo-card-swatch" aria-hidden="true" />As opponents get tougher
        </p>
        <p v-if="reality" class="elo-card-head">
          {{ reality.head }}
        </p>
        <p v-for="(line, i) in reality?.lines ?? []" :key="i" class="elo-card-line">
          {{ line }}
        </p>
      </article>
    </div>

    <aside v-if="timelineLine" class="elo-timeline" data-elo-timeline>
      <p class="elo-timeline-label">
        The honest timeline
      </p>
      <p class="elo-timeline-line">
        {{ timelineLine }}
      </p>
      <p v-if="knowLine" class="elo-timeline-line elo-timeline-know" data-elo-know>
        {{ knowLine }}
      </p>
    </aside>
  </div>
</template>

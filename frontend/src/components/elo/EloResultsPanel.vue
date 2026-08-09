<script setup lang="ts">
import { computed } from 'vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { fmtGames, fmtGamesRange, fmtRank, fmtScoreRank, fmtWeeks } from '@/components/elo/elo-format'
import { fmtCeilingRange } from '@/components/elo/elo-verdict'

// The two futures, side by side. The GAP between them is the whole lesson: a
// steady win rate says "grind N games"; tougher opponents say "you level off
// where your form belongs — getting better moves the ceiling". Below them,
// the honest timeline: the same climb as PERCENTILES of a distribution that
// folds the win-rate sample's uncertainty in (Beta posterior × first-passage),
// plus how many more games it takes to actually pin the rate down.
const {
  naive, decay, projInput, sampleN, winRatePct, targetTier, targetDivision,
  weeksNaive, weeksDecay, gamesToCertainty, ceiling, seasonSim, simHorizonGames,
} = useEloCalc()

const target = computed(() => fmtRank(targetTier.value, targetDivision.value))

// If your wins keep coming — the steady-win-rate future. An upper bound by
// construction: it assumes matchmaking never stiffens.
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
  lines.push('An upper bound — it assumes matchmaking never stiffens; the simulated seasons are the honest number.')
  return { head: fmtGames(n.expectedGames), lines }
})

// As opponents get tougher — the regression-to-form future. The ceiling is
// quoted as its credible RANGE (win-rate posterior × slope CI), matching
// the verdict card — a point rank here overstated three-game samples.
const reality = computed(() => {
  const d = decay.value
  if (!d) return null
  const range = ceiling.value !== null ? fmtCeilingRange(ceiling.value) : fmtScoreRank(d.impliedTrueScore)
  if (d.expectedGames === 0) return { head: 'Already there', lines: [] }
  if (!d.reachable && d.requiredWinRate !== null) {
    return {
      head: `Levels off near ${range}`,
      lines: [
        'Tougher lobbies pull you level here at your current form.',
        // requiredWinRate is the ASYMPTOTE — the rate whose plateau lands
        // exactly on the target — so it holds the rank, it doesn't pass it.
        `To make ${target.value} your plateau, win about ${(d.requiredWinRate * 100).toFixed(1)}% — passing it takes a bit more.`,
      ],
    }
  }
  if (!d.reachable) {
    return { head: `Levels off near ${range}`, lines: ['A losing record settles below the target.'] }
  }
  const lines = [`A bit slower, but ${winRatePct.value}% is high enough to break through.`, `Your ceiling right now: ${range}.`]
  const weeks = fmtWeeks(weeksDecay.value)
  if (weeks) lines.push(weeks)
  return { head: fmtGames(d.expectedGames), lines }
})

// The honest timeline now reads straight off the simulated seasons — the
// SAME distribution as every other probability on the page (the old
// IG-mixture quantiles ignored decay and could promise arrivals the
// verdict had just ruled out).
const timelineLine = computed(() => {
  const sim = seasonSim.value
  if (!sim) return null
  const neverPct = sim.neverShare >= 0.005 ? Math.round(sim.neverShare * 100) : null
  const horizon = simHorizonGames.value
  if (sim.gamesToTarget.p50 === null) {
    return `In ${neverPct}% of ${sim.sims.toLocaleString()} simulated seasons you never touch ${target.value} within ~${horizon} games at this form. Improvement — not more games — moves that number.`
  }
  const parts = [`the fastest tenth touch ${target.value} by ~${sim.gamesToTarget.p10} games`, `the median by ~${sim.gamesToTarget.p50}`]
  if (sim.gamesToTarget.p90 !== null) parts.push(`the slowest tenth by ~${sim.gamesToTarget.p90}`)
  const never = neverPct !== null ? ` · ${neverPct}% never arrive within ~${horizon} games` : ''
  return `Across ${sim.sims.toLocaleString()} simulated seasons: ${parts.join(' · ')}${never}.`
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

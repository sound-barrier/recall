<script setup lang="ts">
import { computed } from 'vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { fmtRank, fmtScoreRank } from '@/components/elo/elo-format'

// "Play the season out" — a bootstrap simulation: each season draws a true
// win rate from the player's record (Beta posterior) and replays it with
// their OWN rank-card meter moves — streak amplification, asymmetry, and
// lobbies that toughen as the season climbs (the same decay the verdict
// uses; every probability on the page comes from THIS simulation). The
// three cells: season odds, the chance of ending LOWER than today, and
// where the season actually lands.
const { seasonSim, simHorizonGames, paceAssumed, targetTier, targetDivision } = useEloCalc()

const target = computed(() => fmtRank(targetTier.value, targetDivision.value))
const pct = (v: number) => `${Math.round(v * 100)}%`

interface Cell { id: string; q: string; a: string; note: string; tone: string }

const cells = computed<Cell[]>(() => {
  const sim = seasonSim.value
  if (!sim) return []
  const paceClause = paceAssumed.value ? ', assuming ~10 games a week' : ' at your pace'
  return [
    {
      id: 'reach', q: `Reach ${target.value} this season?`,
      a: pct(sim.probReachTarget),
      note: `Share of ${sim.sims.toLocaleString()} simulated seasons (~${simHorizonGames.value} games${paceClause}) that touch ${target.value} at least once — touching counts even when the season ends lower.`,
      tone: sim.probReachTarget >= 0.5 ? 'good' : 'neutral',
    },
    {
      id: 'lower', q: 'End lower than today?',
      a: pct(sim.probEndLower),
      note: `Seasons that FINISH below where you sit right now. A season can do both — brush ${target.value} on a heater and still slip back by the end — so this cell and the reach cell overlap by design.`,
      tone: sim.probEndLower > 0.35 ? 'warn' : 'neutral',
    },
    {
      id: 'final', q: 'Where you land',
      a: fmtScoreRank(sim.finalScore.p50),
      note: `The median landing spot; the middle 80% of seasons end between ${fmtScoreRank(sim.finalScore.p10)} and ${fmtScoreRank(sim.finalScore.p90)}.`,
      tone: 'neutral',
    },
  ]
})
</script>

<template>
  <section v-if="cells.length > 0 && seasonSim" class="elo-band" aria-labelledby="elo-sim-title" data-elo-sim>
    <h3 id="elo-sim-title" class="elo-band-title">
      Play the season out — {{ seasonSim.sims.toLocaleString() }} of them
    </h3>
    <p class="elo-band-sub">
      Each simulated season draws a true win rate from your record, then replays your own rank-card moves — streak boosts and all — with lobbies toughening as you climb. Every probability on this page comes from these seasons.
    </p>
    <div class="elo-grid">
      <div v-for="c in cells" :key="c.id" class="elo-cell" :class="c.tone" :data-elo-sim-stat="c.id">
        <p class="elo-cell-q">
          {{ c.q }}
        </p>
        <p class="elo-cell-a">
          {{ c.a }}
        </p>
        <p class="elo-cell-note">
          {{ c.note }}
        </p>
      </div>
    </div>
    <p v-if="!seasonSim.usedEmpiricalMeter" class="elo-band-sub elo-fine-print">
      Not enough rank cards to replay your real meter moves — these seasons use a flat ± typical move per game instead.
    </p>
  </section>
</template>

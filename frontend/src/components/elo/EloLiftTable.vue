<script setup lang="ts">
import { computed } from 'vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { useOWData } from '@/composables/shared/useOWData'
import type { LiftRow } from '@/match/elo-lift'

// "What moves your needle" — every split the app knows (heroes, maps,
// modes, days, times, teammates) as LIFT vs the player's own baseline,
// small samples shrunk toward that baseline so a hot 3–0 can't top the
// chart. Two ranked lists: what helps, what hurts.
const { lift } = useEloCalc()
const ow = useOWData()

const MAX_ROWS = 5

function label(r: LiftRow): string {
  switch (r.dimension) {
    case 'hero': return ow.heroDisplayName(r.key)
    case 'map': return ow.mapDisplayName(r.key)
    case 'mode': return `${r.key} maps`
    case 'day': return `${r.key}s`
    case 'time': return `${r.key} games`
    case 'teammate': return `with ${r.key}`
  }
}

const fmtLift = (v: number) => `×${v.toFixed(2)}`

const helps = computed(() => lift.value.filter((r) => r.lift > 1).slice(0, MAX_ROWS))
const hurts = computed(() => lift.value.filter((r) => r.lift < 1).slice(0, MAX_ROWS))
</script>

<template>
  <section
    v-if="helps.length > 0 || hurts.length > 0"
    class="elo-band"
    aria-labelledby="elo-lift-title"
    data-elo-lift
  >
    <h3 id="elo-lift-title" class="elo-band-title">
      What moves your needle
    </h3>
    <p class="elo-band-sub">
      Every split of your games, as a multiple of your usual win rate — small records are pulled toward your baseline so they can't shout.
    </p>
    <div class="elo-lift-grid">
      <table v-if="helps.length > 0" class="elo-lift-table">
        <caption>What helps</caption>
        <thead>
          <tr>
            <th scope="col">
              Condition
            </th><th scope="col">
              Lift
            </th><th scope="col">
              Likely range
            </th><th scope="col">
              Games
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in helps" :key="`${r.dimension}:${r.key}`" :class="{ low: r.lowSample }" :data-elo-lift-row="`${r.dimension}:${r.key}`">
            <td>{{ label(r) }}</td>
            <td>{{ fmtLift(r.lift) }}</td>
            <td>{{ fmtLift(r.liftLo) }}–{{ fmtLift(r.liftHi) }}</td>
            <td>{{ r.n }}</td>
          </tr>
        </tbody>
      </table>
      <table v-if="hurts.length > 0" class="elo-lift-table">
        <caption>What hurts</caption>
        <thead>
          <tr>
            <th scope="col">
              Condition
            </th><th scope="col">
              Lift
            </th><th scope="col">
              Likely range
            </th><th scope="col">
              Games
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in hurts" :key="`${r.dimension}:${r.key}`" :class="{ low: r.lowSample }" :data-elo-lift-row="`${r.dimension}:${r.key}`">
            <td>{{ label(r) }}</td>
            <td>{{ fmtLift(r.lift) }}</td>
            <td>{{ fmtLift(r.liftLo) }}–{{ fmtLift(r.liftHi) }}</td>
            <td>{{ r.n }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="elo-band-sub elo-fine-print">
      Correlation, not causation — and with this many splits, a couple of moderate lifts are expected by chance. Trust the ranking more than any single row.
    </p>
  </section>
</template>

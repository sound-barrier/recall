<script setup lang="ts">
import { computed } from 'vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { useOWData } from '@/composables/shared/useOWData'

// "Your best heroes vs your worst" — the climb-speed gap, approximated in
// the player's own meter: per-game expected movement on the strongest
// evidenced hero vs the weakest, and what that buys per 20 games. Rates
// are the shrunk ones and both heroes carry 15+ decisive games, so this
// is advice, not noise.
const { heroGap } = useEloCalc()
const ow = useOWData()

function worstHeroReads(perGamePts: number): string {
  if (perGamePts < -0.5) return `gives rank back (≈${Math.abs(perGamePts).toFixed(1)}%/game)`
  if (perGamePts > 0.5) return `still climbs, slower (≈+${perGamePts.toFixed(1)}%/game)`
  return 'treads water'
}

const line = computed(() => {
  const g = heroGap.value
  if (!g) return null
  const best = ow.heroDisplayName(g.best.key)
  const worst = ow.heroDisplayName(g.worst.key)
  const bestRate = g.best.adjustedWinrate ?? g.best.winrate
  const worstRate = g.worst.adjustedWinrate ?? g.worst.winrate
  const per20 = g.gapPerGamePts * 20
  const divisions = per20 / 100
  const size = divisions >= 0.95 ? `about ${Math.round(divisions * 10) / 10} division${divisions >= 1.95 ? 's' : ''}` : `≈${Math.round(per20)}% of a division`
  const worstReads = worstHeroReads(g.worstPerGamePts)
  return {
    head: `${best} climbs ≈${g.gapPerGamePts.toFixed(1)}% meter per game faster than ${worst}`,
    detail: `${best} (${bestRate}% over ${g.best.wins + g.best.losses} games) earns ≈${g.bestPerGamePts.toFixed(1)}% meter a game; ${worst} (${worstRate}% over ${g.worst.wins + g.worst.losses} games) ${worstReads}. Twenty games on the right pick is worth ${size} of climb — hero choice is a rank lever, not a mood.`,
  }
})
</script>

<template>
  <section v-if="line" class="elo-playbook-block" aria-labelledby="elo-hero-gap-title" data-elo-hero-gap>
    <h4 id="elo-hero-gap-title" class="elo-subhead">
      Your best heroes vs your worst
    </h4>
    <div class="elo-cell neutral elo-hero-gap-cell">
      <p class="elo-cell-a">
        {{ line.head }}
      </p>
      <p class="elo-cell-note">
        {{ line.detail }}
      </p>
    </div>
    <p class="elo-band-sub elo-fine-print">
      An approximation from your own record and meter — shrunk rates, evidenced heroes only. Enemy comps still exist; play the counter when it matters.
    </p>
  </section>
</template>

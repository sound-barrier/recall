<script setup lang="ts">
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { useOWData } from '@/composables/shared/useOWData'
import type { HeroPickStat } from '@/match/elo-seed'

// Tick heroes to use only their games as the win rate ("what if I only queued
// these?"). Each row shows the hero's own record and whether it's in your usual
// pool — off-pool picks are the honest "you're spending rank on practice" flag.
// Small records also carry an adjusted rate shrunk toward the pooled record,
// shown only when it meaningfully disagrees with the raw one.
const { heroStats, selectedHeroes, toggleHero } = useEloCalc()
const ow = useOWData()

function recordText(h: HeroPickStat): string {
  const margin = h.marginPts !== null ? ` ± ${h.marginPts}` : ''
  const adj = h.adjustedWinrate !== null && Math.abs(h.adjustedWinrate - h.winrate) >= 2
    ? ` · adj ${h.adjustedWinrate}%`
    : ''
  return `${h.winrate}%${margin}${adj} · ${h.wins + h.losses} games`
}
</script>

<template>
  <fieldset v-if="heroStats.length > 0" class="elo-heroes">
    <legend class="elo-legend">
      Or use only certain heroes
    </legend>
    <p class="elo-hint">
      Tick heroes to set the win rate from just their games. A multi-hero match counts once per hero.
      "adj" pulls a small record toward your overall rate — a hot 3–0 isn't really 100%.
    </p>
    <ul class="elo-heroes-list">
      <li v-for="h in heroStats" :key="h.key" :data-elo-hero="h.key">
        <label class="elo-hero-row">
          <input type="checkbox" :checked="selectedHeroes.has(h.key)" @change="toggleHero(h.key)">
          <span class="elo-hero-name">{{ ow.heroDisplayName(h.key) }}</span>
          <span class="elo-hero-record">{{ recordText(h) }}</span>
          <span class="elo-pool" :class="{ out: !h.inPool }" data-pool-badge>
            {{ h.inPool ? 'in pool' : 'out of pool' }}
          </span>
          <span v-if="h.lowSample" class="elo-lown" title="Fewer than 5 games — treat this rate as noisy">n&lt;5</span>
        </label>
      </li>
    </ul>
  </fieldset>
</template>

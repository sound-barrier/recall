<script setup lang="ts">
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { useOWData } from '@/composables/shared/useOWData'

// Tick heroes to use only their games as the win rate ("what if I only queued
// these?"). Each row shows the hero's own record and whether it's in your usual
// pool — off-pool picks are the honest "you're spending rank on practice" flag.
const { heroStats, selectedHeroes, toggleHero } = useEloCalc()
const ow = useOWData()

function recordText(wins: number, losses: number, winrate: number, marginPts: number | null): string {
  const margin = marginPts !== null ? ` ± ${marginPts}` : ''
  return `${winrate}%${margin} · ${wins + losses} games`
}
</script>

<template>
  <fieldset v-if="heroStats.length > 0" class="elo-heroes">
    <legend class="elo-legend">
      Or use only certain heroes
    </legend>
    <p class="elo-hint">
      Tick heroes to set the win rate from just their games. A multi-hero match counts once per hero.
    </p>
    <ul class="elo-heroes-list">
      <li v-for="h in heroStats" :key="h.key" :data-elo-hero="h.key">
        <label class="elo-hero-row">
          <input type="checkbox" :checked="selectedHeroes.has(h.key)" @change="toggleHero(h.key)">
          <span class="elo-hero-name">{{ ow.heroDisplayName(h.key) }}</span>
          <span class="elo-hero-record">{{ recordText(h.wins, h.losses, h.winrate, h.marginPts) }}</span>
          <span class="elo-pool" :class="{ out: !h.inPool }" data-pool-badge>
            {{ h.inPool ? 'in pool' : 'out of pool' }}
          </span>
          <span v-if="h.lowSample" class="elo-lown" title="Fewer than 5 games — treat this rate as noisy">n&lt;5</span>
        </label>
      </li>
    </ul>
  </fieldset>
</template>

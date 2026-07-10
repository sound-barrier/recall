<script setup lang="ts">
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { useOWData } from '@/composables/shared/useOWData'
import type { HeroPickStat } from '@/match/elo-seed'
import { clampHeroAdjust, HERO_ADJUST_STEP } from '@/match/elo-whatif'

// Tick heroes to use only their games as the win rate ("what if I only queued
// these?"). Each row shows the hero's own record and whether it's in your usual
// pool — off-pool picks are the honest "you're spending rank on practice" flag.
// Small records also carry an adjusted rate shrunk toward the pooled record,
// shown only when it meaningfully disagrees with the raw one.
// The ▲▼ arrows nudge a hero's rate ±5 points — a layered what-if, weighted by
// how much you play them, that every projection above follows.
const {
  heroStats, selectedHeroes, toggleHero,
  heroAdjustPts, bumpHero, resetHeroAdjust, whatIf, winRatePct, effectiveWinRatePct,
} = useEloCalc()
const ow = useOWData()

function recordText(h: HeroPickStat): string {
  const margin = h.marginPts !== null ? ` ± ${h.marginPts}` : ''
  const adj = h.adjustedWinrate !== null && Math.abs(h.adjustedWinrate - h.winrate) >= 2
    ? ` · adj ${h.adjustedWinrate}%`
    : ''
  return `${h.winrate}%${margin}${adj} · ${h.wins + h.losses} games`
}

function nudgeChip(h: HeroPickStat): string | null {
  const nudged = whatIf.value.perHero.get(h.key)
  return nudged ? `${nudged.from}% → ${nudged.to}%` : null
}

// Arrows dead-end at the ±25 saturation, the 0/100 rate bounds, and on
// rows outside an active selection (their games aren't in the sample).
function outOfScope(h: HeroPickStat): boolean {
  return selectedHeroes.value.size > 0 && !selectedHeroes.value.has(h.key)
}
function canNudge(h: HeroPickStat, dir: 1 | -1): boolean {
  if (outOfScope(h)) return false
  const current = heroAdjustPts.value.get(h.key) ?? 0
  if (clampHeroAdjust(current, dir) === current) return false
  const rate = h.winrate + current
  return dir === 1 ? rate < 100 : rate > 0
}

const deltaPts = () => {
  const base = winRatePct.value
  const effective = effectiveWinRatePct.value
  if (base === null || effective === null) return 0
  return Math.round((effective - base) * 10) / 10
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
      The ▲▼ arrows ask a different question: what if you got {{ HERO_ADJUST_STEP }} points better (or worse)
      on that hero? The blend moves by their share of your games.
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
        <span class="elo-nudge" role="group" :aria-label="`What-if nudge for ${ow.heroDisplayName(h.key)}`">
          <span v-if="nudgeChip(h)" class="elo-nudge-chip" data-elo-nudge-chip>{{ nudgeChip(h) }}</span>
          <button
            type="button"
            class="elo-nudge-btn"
            data-elo-nudge="down"
            :aria-label="`Lower ${ow.heroDisplayName(h.key)} win rate ${HERO_ADJUST_STEP} points`"
            :disabled="!canNudge(h, -1)"
            @click="bumpHero(h.key, -1)"
          >▼</button>
          <button
            type="button"
            class="elo-nudge-btn"
            data-elo-nudge="up"
            :aria-label="`Raise ${ow.heroDisplayName(h.key)} win rate ${HERO_ADJUST_STEP} points`"
            :disabled="!canNudge(h, 1)"
            @click="bumpHero(h.key, 1)"
          >▲</button>
        </span>
      </li>
    </ul>
    <p v-if="deltaPts() !== 0" class="elo-nudge-summary" data-elo-whatif-summary role="status">
      <span>
        Blended what-if: {{ winRatePct }}% → {{ effectiveWinRatePct }}%
        ({{ deltaPts() > 0 ? '+' : '' }}{{ deltaPts() }} pts). Every projection above follows it.
      </span>
      <button type="button" class="elo-nudge-reset" data-elo-nudge-reset @click="resetHeroAdjust">
        Reset nudges
      </button>
    </p>
  </fieldset>
</template>

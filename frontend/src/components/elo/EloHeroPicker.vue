<script setup lang="ts">
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { useOWData } from '@/composables/shared/useOWData'
import type { HeroPickStat } from '@/match/elo-seed'
import { clampHeroAdjust, HERO_ADJUST_MAX, HERO_ADJUST_STEP } from '@/match/elo-whatif'
import { heatmapCellClass, heatmapCellOpacity } from '@/match/match-heatmap-helpers'

// Click heroes to use only their games as the win rate ("what if I only
// queued these?") — a highlighted row is in the sample; none highlighted
// means the whole track counts. Rows speak the Hero Pool band's language — pool/off badge, a
// WR-heat bar, the right-aligned record — so the two hero surfaces read as
// one; the Wilson margin and shrunk rate live in the stat's tooltip. The
// stepper nudges a hero one point per press (±5 max): a layered what-if,
// weighted by how much you play them, that every projection above follows.
const {
  heroStats, selectedHeroes, toggleHero, selectAllHeroes, clearHeroSelection,
  heroAdjustPts, bumpHero, resetHeroAdjust, whatIf, winRatePct, effectiveWinRatePct,
} = useEloCalc()
const ow = useOWData()

// nudgedTo: the hero's rate with its active in-scope nudge applied.
function nudgedTo(h: HeroPickStat): number | null {
  return whatIf.value.perHero.get(h.key)?.to ?? null
}

function offset(h: HeroPickStat): number {
  return heroAdjustPts.value.get(h.key) ?? 0
}

function offsetText(h: HeroPickStat): string {
  const v = offset(h)
  return v > 0 ? `+${v}` : String(v)
}

// The bar wears the heat class of the rate ON DISPLAY, so a nudge visibly
// re-sizes and re-tints it.
function heatShape(h: HeroPickStat): { total: number; winrate: number; wins: number; losses: number } {
  return { total: h.wins + h.losses, winrate: nudgedTo(h) ?? h.winrate, wins: h.wins, losses: h.losses }
}

function statTitle(h: HeroPickStat): string | undefined {
  const parts = []
  if (h.marginPts !== null) parts.push(`±${h.marginPts} points (Wilson)`)
  if (h.adjustedWinrate !== null) parts.push(`shrunk toward your pooled rate: ${h.adjustedWinrate}%`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

// Arrows dead-end at the ±5 saturation, the 0/100 rate bounds, and on
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
      Click heroes to set the win rate from just their games — highlighted rows are the ones being counted;
      no highlight means every game on this track counts. A multi-hero match counts once per hero.
      The ▲▼ stepper asks: what if you got {{ HERO_ADJUST_STEP }} point better — or worse — on that hero?
      Up to ±{{ HERO_ADJUST_MAX }}, blended by their share of your games.
    </p>
    <div class="elo-hero-toolbar">
      <button
        type="button"
        class="elo-hero-select-btn"
        data-elo-select-all
        :disabled="heroStats.length > 0 && selectedHeroes.size === heroStats.length"
        @click="selectAllHeroes"
      >
        Select all
      </button>
      <button
        type="button"
        class="elo-hero-select-btn"
        data-elo-unselect-all
        :disabled="selectedHeroes.size === 0"
        @click="clearHeroSelection"
      >
        Unselect all
      </button>
    </div>
    <ul class="elo-heroes-list">
      <li v-for="h in heroStats" :key="h.key" :data-elo-hero="h.key">
        <button
          type="button"
          class="elo-hero-row"
          :class="{ selected: selectedHeroes.has(h.key) }"
          :aria-pressed="selectedHeroes.has(h.key) ? 'true' : 'false'"
          @click="toggleHero(h.key)"
        >
          <span class="elo-hero-name">{{ ow.heroDisplayName(h.key) }}</span>
          <span class="elo-hero-tag" :class="{ out: !h.inPool }" data-pool-badge>{{ h.inPool ? 'pool' : 'off' }}</span>
          <span class="elo-hero-bar" aria-hidden="true">
            <span
              class="elo-hero-fill"
              :class="heatmapCellClass(heatShape(h))"
              :style="{ width: `${nudgedTo(h) ?? h.winrate}%`, opacity: heatmapCellOpacity(heatShape(h)) }"
            />
          </span>
          <span class="elo-hero-stat" data-elo-hero-stat :title="statTitle(h)">
            {{ h.wins + h.losses }}x · {{ h.winrate }}%<span v-if="nudgedTo(h) !== null" class="elo-hero-nudged"> → {{ nudgedTo(h) }}%</span>
            <span v-if="h.lowSample" class="elo-lown" title="Fewer than 5 games — treat this rate as noisy">n&lt;5</span>
          </span>
        </button>
        <span class="elo-nudge" role="group" :aria-label="`What-if nudge for ${ow.heroDisplayName(h.key)}`">
          <button
            type="button"
            class="elo-nudge-btn"
            data-elo-nudge="down"
            :aria-label="`Lower ${ow.heroDisplayName(h.key)} win rate ${HERO_ADJUST_STEP} point`"
            :disabled="!canNudge(h, -1)"
            @click="bumpHero(h.key, -1)"
          >▼</button>
          <span class="elo-nudge-offset" :class="{ active: offset(h) !== 0 }" data-elo-nudge-offset aria-hidden="true">{{ offsetText(h) }}</span>
          <button
            type="button"
            class="elo-nudge-btn"
            data-elo-nudge="up"
            :aria-label="`Raise ${ow.heroDisplayName(h.key)} win rate ${HERO_ADJUST_STEP} point`"
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

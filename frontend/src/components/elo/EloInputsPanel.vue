<script setup lang="ts">
import { computed } from 'vue'
import { TIER_ORDER, type Tier } from '@/match/match-trends-helpers'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { DEFAULT_METER_MOVE_PCT } from '@/match/elo-model'

// The calculator form: every input starts from the picked track's own games and
// stays editable. Manual edits stop the background re-seed; win-rate/sample
// edits also drop the hero picker so the two never fight over the win rate.
const {
  currentTier, currentDivision, currentProgress, targetTier, targetDivision,
  winRatePct, sampleN, meterMovePct, gamesPerWeekInput, decaySlopePts,
  editInput, lastSeed,
} = useEloCalc()

const DIVISIONS = [5, 4, 3, 2, 1]
const tierName = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

function num(e: Event): number {
  return Number((e.target as HTMLInputElement).value)
}

const wrHint = computed(() => {
  const s = lastSeed.value
  if (!s || s.winRate === null) return 'No ranked games on this track — type in your own.'
  return `From your games: ${(s.winRate * 100).toFixed(1)}% over ${s.wins + s.losses} games.`
})

const meterHint = computed(() => {
  const s = lastSeed.value
  if (!s || s.meterSampleN < 3) return `Using the typical ${DEFAULT_METER_MOVE_PCT}% — too few rank screens to measure yours.`
  return `Measured from ${s.meterSampleN} of your rank screens.`
})
</script>

<template>
  <div class="elo-form">
    <fieldset class="elo-fieldset">
      <legend class="elo-legend">
        Where you are
      </legend>
      <div class="elo-row">
        <label class="elo-field">
          <span class="elo-field-label">Tier</span>
          <select
            class="elo-input" data-elo-current="tier" :value="currentTier"
            @change="editInput('currentTier', ($event.target as HTMLSelectElement).value as Tier)"
          >
            <option v-for="t in TIER_ORDER" :key="t" :value="t">{{ tierName(t) }}</option>
          </select>
        </label>
        <label class="elo-field">
          <span class="elo-field-label">Division</span>
          <select
            class="elo-input" data-elo-current="division" :value="String(currentDivision)"
            @change="editInput('currentDivision', num($event))"
          >
            <option v-for="d in DIVISIONS" :key="d" :value="String(d)">{{ d }}</option>
          </select>
        </label>
        <label class="elo-field">
          <span class="elo-field-label">Rank bar %</span>
          <input
            class="elo-input" data-elo-current="progress" type="number" min="0" max="99" step="1"
            :value="currentProgress" @change="editInput('currentProgress', num($event))"
          >
        </label>
      </div>
    </fieldset>

    <fieldset class="elo-fieldset">
      <legend class="elo-legend">
        Where you want to be
      </legend>
      <div class="elo-row">
        <label class="elo-field">
          <span class="elo-field-label">Tier</span>
          <select
            class="elo-input" data-elo-target="tier" :value="targetTier"
            @change="editInput('targetTier', ($event.target as HTMLSelectElement).value as Tier)"
          >
            <option v-for="t in TIER_ORDER" :key="t" :value="t">{{ tierName(t) }}</option>
          </select>
        </label>
        <label class="elo-field">
          <span class="elo-field-label">Division</span>
          <select
            class="elo-input" data-elo-target="division" :value="String(targetDivision)"
            @change="editInput('targetDivision', num($event))"
          >
            <option v-for="d in DIVISIONS" :key="d" :value="String(d)">{{ d }}</option>
          </select>
        </label>
      </div>
    </fieldset>

    <fieldset class="elo-fieldset">
      <legend class="elo-legend">
        Your recent form
      </legend>
      <div class="elo-row">
        <label class="elo-field">
          <span class="elo-field-label">Win rate %</span>
          <input
            class="elo-input" data-elo-input="win-rate" type="number" min="0" max="100" step="0.1"
            :value="winRatePct ?? ''" @change="editInput('winRatePct', num($event), { detachHeroes: true })"
          >
          <small class="elo-hint">{{ wrHint }}</small>
        </label>
        <label class="elo-field">
          <span class="elo-field-label">Games counted</span>
          <input
            class="elo-input" data-elo-input="sample-n" type="number" min="0" step="1"
            :value="sampleN" @change="editInput('sampleN', num($event), { detachHeroes: true })"
          >
          <small class="elo-hint">How many games that win rate is from.</small>
        </label>
        <label class="elo-field">
          <span class="elo-field-label">Games per week</span>
          <input
            class="elo-input" data-elo-input="games-week" type="number" min="0" step="0.1"
            :value="gamesPerWeekInput ?? ''" @change="editInput('gamesPerWeekInput', num($event))"
          >
          <small class="elo-hint">Your recent pace — turns games into weeks.</small>
        </label>
        <label class="elo-field">
          <span class="elo-field-label">Rank bar per game</span>
          <input
            class="elo-input" data-elo-input="meter-move" type="number" min="1" max="40" step="0.1"
            :value="meterMovePct" @change="editInput('meterMovePct', num($event))"
          >
          <small class="elo-hint">{{ meterHint }}</small>
        </label>
      </div>
    </fieldset>

    <details class="elo-advanced">
      <summary>Advanced</summary>
      <label class="elo-field elo-field-wide">
        <span class="elo-field-label">How fast it gets harder</span>
        <input
          class="elo-input" data-elo-input="decay-slope" type="number" min="0.5" max="5" step="0.1"
          :value="decaySlopePts" @change="editInput('decaySlopePts', num($event))"
        >
        <small class="elo-hint">
          Win-rate points you lose per division climbed as opponents improve (default 1.5).
        </small>
      </label>
    </details>
  </div>
</template>

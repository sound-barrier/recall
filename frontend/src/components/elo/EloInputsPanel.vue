<script setup lang="ts">
import { computed } from 'vue'
import { TIER_ORDER, type Tier } from '@/match/trends/match-trends-helpers'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { DEFAULT_METER_MOVE_PCT } from '@/match/elo/elo-model'
import { fmtScoreRank } from '@/components/elo/elo-format'

// The calculator form: every input starts from the picked track's own games and
// stays editable. Manual edits stop the background re-seed; win-rate/sample
// edits also drop the hero picker so the two never fight over the win rate.
const {
  currentTier, currentDivision, currentProgress, targetTier, targetDivision,
  winRatePct, sampleN, meterMovePct, gamesPerWeekInput, decaySlopePts,
  editInput, lastSeed, decay, projInput, editedFields, isEdited, resetToMeasured,
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

// The decay-slope provenance: measured from the player's own climb when the
// history can identify it (a logistic fit of result vs the rank held at play
// time), else the honest "this is a default" copy — so the number is never a
// mystery knob the user is asked to guess.
const slopeHint = computed(() => {
  const m = lastSeed.value?.decaySlope ?? null
  if (m === null) {
    return 'Win-rate points you lose per division climbed (default 1.5) — not enough ranked history to measure yours yet.'
  }
  const r1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1)
  return `Measured from your climb: ${r1(m.pts)} pts per division (95% range ${r1(m.lowerPts)}–${r1(m.upperPts)}, ${m.n} ranked games).`
})

// Live consequence line: what the CURRENT slope value means in ranks — the
// ceiling the decay model levels off at. Changes as the user drags the knob.
const plateauLine = computed(() => {
  if (!projInput.value || !decay.value) return null
  return `At exactly ${decaySlopePts.value} pts per division, your current form levels off near ${fmtScoreRank(decay.value.impliedTrueScore)} — the cards above quote it as a range because neither the slope nor your rate is exact.`
})
</script>

<template>
  <div class="elo-form">
    <div class="elo-form-head">
      <button
        type="button"
        class="elo-hero-select-btn"
        data-elo-reset-measured
        :disabled="!isEdited"
        title="Put every dial back to what your games measured"
        @click="resetToMeasured"
      >
        Reset to measured
      </button>
    </div>
    <fieldset class="elo-fieldset">
      <legend class="elo-legend">
        Where you are
      </legend>
      <div class="elo-row">
        <label class="elo-field">
          <span class="elo-field-label">Tier</span><span v-if="editedFields.currentTier" class="elo-edited-dot" data-elo-edited="current-tier" title="Differs from your measured number">●</span>
          <select
            class="elo-input" data-elo-current="tier" :value="currentTier"
            @change="editInput('currentTier', ($event.target as HTMLSelectElement).value as Tier)"
          >
            <option v-for="t in TIER_ORDER" :key="t" :value="t">{{ tierName(t) }}</option>
          </select>
        </label>
        <label class="elo-field">
          <span class="elo-field-label">Division</span><span v-if="editedFields.currentDivision" class="elo-edited-dot" data-elo-edited="current-division" title="Differs from your measured number">●</span>
          <select
            class="elo-input" data-elo-current="division" :value="String(currentDivision)"
            @change="editInput('currentDivision', num($event))"
          >
            <option v-for="d in DIVISIONS" :key="d" :value="String(d)">{{ d }}</option>
          </select>
        </label>
        <label class="elo-field">
          <span class="elo-field-label">Rank bar %</span><span v-if="editedFields.currentProgress" class="elo-edited-dot" data-elo-edited="current-progress" title="Differs from your measured number">●</span>
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
          <span class="elo-field-label">Tier</span><span v-if="editedFields.targetTier" class="elo-edited-dot" data-elo-edited="target-tier" title="Differs from your measured number">●</span>
          <select
            class="elo-input" data-elo-target="tier" :value="targetTier"
            @change="editInput('targetTier', ($event.target as HTMLSelectElement).value as Tier)"
          >
            <option v-for="t in TIER_ORDER" :key="t" :value="t">{{ tierName(t) }}</option>
          </select>
        </label>
        <label class="elo-field">
          <span class="elo-field-label">Division</span><span v-if="editedFields.targetDivision" class="elo-edited-dot" data-elo-edited="target-division" title="Differs from your measured number">●</span>
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
          <span class="elo-field-label">Win rate %</span><span v-if="editedFields.winRatePct" class="elo-edited-dot" data-elo-edited="win-rate" title="Differs from your measured number">●</span>
          <input
            class="elo-input" data-elo-input="win-rate" type="number" min="0" max="100" step="0.1"
            :value="winRatePct ?? ''" @change="editInput('winRatePct', num($event), { detachHeroes: true })"
          >
          <small class="elo-hint">{{ wrHint }}</small>
        </label>
        <label class="elo-field">
          <span class="elo-field-label">Games counted</span><span v-if="editedFields.sampleN" class="elo-edited-dot" data-elo-edited="sample-n" title="Differs from your measured number">●</span>
          <input
            class="elo-input" data-elo-input="sample-n" type="number" min="0" step="1"
            :value="sampleN" @change="editInput('sampleN', num($event), { detachHeroes: true })"
          >
          <small class="elo-hint">How many games that win rate is from.</small>
        </label>
        <label class="elo-field">
          <span class="elo-field-label">Games per week</span><span v-if="editedFields.gamesPerWeekInput" class="elo-edited-dot" data-elo-edited="games-week" title="Differs from your measured number">●</span>
          <input
            class="elo-input" data-elo-input="games-week" type="number" min="0" step="0.1"
            :value="gamesPerWeekInput ?? ''" @change="editInput('gamesPerWeekInput', num($event))"
          >
          <small class="elo-hint">Your recent pace — turns games into weeks.</small>
        </label>
        <label class="elo-field">
          <span class="elo-field-label">Rank bar per game</span><span v-if="editedFields.meterMovePct" class="elo-edited-dot" data-elo-edited="meter-move" title="Differs from your measured number">●</span>
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
        <span class="elo-field-label">How fast it gets harder</span><span v-if="editedFields.decaySlopePts" class="elo-edited-dot" data-elo-edited="decay-slope" title="Differs from your measured number">●</span>
        <input
          class="elo-input" data-elo-input="decay-slope" type="number" min="0.5" max="5" step="0.1"
          :value="decaySlopePts" @change="editInput('decaySlopePts', num($event))"
        >
        <small class="elo-hint" data-elo-slope-hint>{{ slopeHint }}</small>
        <small v-if="plateauLine" class="elo-hint elo-plateau" data-elo-plateau>{{ plateauLine }}</small>
      </label>
    </details>
  </div>
</template>

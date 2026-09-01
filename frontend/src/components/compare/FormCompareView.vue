<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'

import type { MatchRecord } from '@/api-client'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import { useOWData } from '@/composables/shared/useOWData'
import { useMatchesDossier } from '@/composables/matches/dossier/useMatchesDossier'
import { matchesLeaverHandling } from '@/composables/matches/narrow/narrowPredicates'
import { useFormDrill } from '@/composables/compare/useFormDrill'
import { N_OPTIONS, useFormPairing } from '@/composables/compare/useFormPairing'
import { buildSeasonMetrics, topHeroDisplay } from '@/components/compare/compareSnapshot'
import { SPARK_H, SPARK_W, midY, sparkAria, sparkPoints } from '@/match/trends/spark-line'
import CompareTable from '@/components/compare/CompareTable.vue'
import { compareSeasons, type ComparisonRow } from '@/match/compare/match-compare-helpers'
import { judgeForm } from '@/match/compare/match-form-verdict'
import { leaverRate, sessionCount } from '@/match/dossier/match-momentum-helpers'
import {
  buildCondition, conditionDrillable, conditionPredicate, pairByTime, rollingWinrate, windowDays,
  type FormCondition, type TimeWindow,
} from '@/match/compare/match-form-slices'

// FORM — the Compare tab's second mode. Two adjacent windows of play — this
// period vs the previous one (mirrored to the same length) or the last N
// matches vs the N before — judged into a verdict word with the biggest
// movers, a facing sparkline pair for each period's shape, and the shared
// A/B/Δ evidence table below. Cells drill through to the Matches tab.

const matchesStore = useMatchesStore()
const ow = useOWData()
const { weekStart } = storeToRefs(useSettingsStore())
const { drill } = useFormDrill()

// ─── Conditions (per column) ──────────────────────────────────────────────
const condKindA = ref('any')
const condKindB = ref('any')
const condMemberA = ref('')
const condMemberB = ref('')
const condHeroA = ref('')
const condHeroB = ref('')

const availableMembers = matchesStore.matchesNarrow.availableMembers
const availableHeroes = matchesStore.matchesNarrow.availableHeroes

const condA = computed(() => buildCondition(condKindA.value, condMemberA.value, condHeroA.value))
const condB = computed(() => buildCondition(condKindB.value, condMemberB.value, condHeroB.value))

// ─── Slices → snapshots → verdict ─────────────────────────────────────────
// Beyond hidden-stripping + the leaver 'Hide' setting, unknown-map records are
// excluded to match the Matches view's default (includeUnknown=false) — a
// drilled-through cell then shows exactly the records it counted.
const visibleRecords = computed<MatchRecord[]>(() =>
  matchesStore.records.filter(
    (r) => !r.hidden
      && !!r.data?.map
      && matchesLeaverHandling(r, matchesStore.matchesNarrow.leaverHandling.value),
  ),
)

// ─── Pairing state (composed) ─────────────────────────────────────────────
// Windows, presets, and the record pair live in useFormPairing;
// destructured into same-named locals so the template stays untouched.
const {
  pairBy, bFrom, bTo, aLocked, aFrom, aTo, nPick, activePreset,
  applyTrailingPreset, applyMatchesPreset, samePoint, applySamePointPreset,
  onManualEdit, setPairBy, bWindow, aWindow, pair,
} = useFormPairing({ visibleRecords, seasons: ow.seasons })

const recordsA = computed<MatchRecord[]>(() => pair.value.a.filter(conditionPredicate(condA.value, ow.heroRole)))
const recordsB = computed<MatchRecord[]>(() => pair.value.b.filter(conditionPredicate(condB.value, ow.heroRole)))

const leaverHandling = matchesStore.matchesNarrow.leaverHandling
// Threaded beside leaverHandling, never one without the other — both
// are the user saying which matches their record is made of.
const exclusionHandling = matchesStore.matchesNarrow.exclusionHandling
const dossierA = useMatchesDossier(recordsA, leaverHandling, { exclusionHandling, heroRole: ow.heroRole, weekStart })
const dossierB = useMatchesDossier(recordsB, leaverHandling, { exclusionHandling, heroRole: ow.heroRole, weekStart })
const topHeroA = dossierA.topByCount({ getter: (r) => r.data?.hero || undefined, limit: 1 })
const topHeroB = dossierB.topByCount({ getter: (r) => r.data?.hero || undefined, limit: 1 })

function rankDivisions(records: MatchRecord[]): number | null {
  let sum = 0
  let carries = 0
  for (const r of records) {
    const change = r.data?.change_percent
    if (typeof change === 'number') { sum += change; carries++ }
  }
  return carries === 0 ? null : sum / 100
}

function snapshot(d: typeof dossierA, records: MatchRecord[], topHero: string | null) {
  return buildSeasonMetrics(d, records, {
    topHero,
    ow,
    extras: {
      rankProgress: rankDivisions(records),
      sessions: sessionCount(records),
      leaverRatePct: leaverRate(records).rate,
    },
  })
}

const snapA = computed(() => snapshot(dossierA, recordsA.value, topHeroDisplay(topHeroA.value, ow)))
const snapB = computed(() => snapshot(dossierB, recordsB.value, topHeroDisplay(topHeroB.value, ow)))

const sections = computed(() => compareSeasons(snapA.value, snapB.value))
const verdict = computed(() => judgeForm(snapA.value, snapB.value))
const anyLowSample = computed(() => sections.value.some((s) => s.rows.some((r) => r.lowSample)))

// ─── Labels ───────────────────────────────────────────────────────────────
function windowLabel(w: TimeWindow | null): string {
  return w ? `${w.from} – ${w.to}` : '—'
}

const labelA = computed(() =>
  pairBy.value === 'matches' ? `Prior ${nPick.value}` : `Previous · ${windowLabel(aWindow.value)}`)
const labelB = computed(() =>
  pairBy.value === 'matches' ? `Last ${nPick.value}` : `This period · ${windowLabel(bWindow.value)}`)

const liveSummary = computed(() => `${verdict.value.word} — comparing ${labelB.value} against ${labelA.value}.`)

// ─── Sparklines (geometry in form-sparkline) ──────────────────────────────
const sparkValuesA = computed(() => rollingWinrate(recordsA.value))
const sparkValuesB = computed(() => rollingWinrate(recordsB.value))
const sparkA = computed(() => sparkPoints(sparkValuesA.value))
const sparkB = computed(() => sparkPoints(sparkValuesB.value))
const sparkAriaA = computed(() => sparkAria(sparkValuesA.value, 'in the baseline window'))
const sparkAriaB = computed(() => sparkAria(sparkValuesB.value, 'this period'))

// ─── Drill-through ────────────────────────────────────────────────────────
const ROLE_ROW_KEYS: Record<string, string> = { roleTank: 'tank', roleDps: 'dps', roleSupport: 'support' }

// Rows whose dimension the narrow can't express at all: there is no per-match
// hero-count or hero-pool clause, so a window-only drill would land on a list
// whose count contradicts the cell. Not drillable rather than approximately so.
const NON_DRILLABLE_ROWS = new Set(['heroPool', 'singleHero', 'multiHero', 'purePool', 'outPool'])

// In by-matches mode the drill expresses a COUNT window as its first/last
// match dates — only exact when no extra match shares those boundary days.
// Verify by re-counting: a cell is drillable only when the derived window +
// condition reproduces exactly the records the cell aggregated.
function windowIsExact(col: 'a' | 'b'): boolean {
  if (pairBy.value === 'time') return true
  const window = col === 'a' ? pair.value.aWindow : pair.value.bWindow
  if (!window) return false
  const cond = col === 'a' ? condA.value : condB.value
  const sliced = col === 'a' ? recordsA.value : recordsB.value
  const rematched = pairByTime(visibleRecords.value, window, window).b
    .filter(conditionPredicate(cond, ow.heroRole))
  return rematched.length === sliced.length
}

// A role row under a DIFFERENT role condition can't be expressed — the
// narrow's role picks OR together, so two picks widen instead of intersect.
function roleRowConflicts(rowKey: string, cond: FormCondition): boolean {
  const rowRole = ROLE_ROW_KEYS[rowKey]
  return Boolean(rowRole && cond.kind === 'role' && cond.role !== rowRole)
}

function drillable(row: ComparisonRow, col: 'a' | 'b'): boolean {
  if (NON_DRILLABLE_ROWS.has(row.key)) return false
  const window = col === 'a' ? pair.value.aWindow : pair.value.bWindow
  const cond = col === 'a' ? condA.value : condB.value
  const display = col === 'a' ? row.aDisplay : row.bDisplay
  if (window === null || display === '—' || !conditionDrillable(cond)) return false
  if (roleRowConflicts(row.key, cond)) return false
  return windowIsExact(col)
}

function onDrill(rowKey: string, col: 'a' | 'b') {
  const window = col === 'a' ? pair.value.aWindow : pair.value.bWindow
  if (!window) return
  drill(rowKey, window, col === 'a' ? condA.value : condB.value)
}
</script>

<template>
  <div class="form-compare">
    <!-- Preset pairs — the daily drivers. -->
    <div class="form-presets" role="group" aria-label="Comparison presets">
      <button
        type="button" class="form-preset" :class="{ active: activePreset === '7d' }"
        :aria-pressed="activePreset === '7d'" data-form-preset="7d"
        @click="applyTrailingPreset(7, '7d')"
      >
        Last 7d vs prior 7d
      </button>
      <button
        type="button" class="form-preset" :class="{ active: activePreset === '30d' }"
        :aria-pressed="activePreset === '30d'" data-form-preset="30d"
        @click="applyTrailingPreset(30, '30d')"
      >
        Last 30d vs prior 30d
      </button>
      <button
        type="button" class="form-preset" :class="{ active: activePreset === '20m' }"
        :aria-pressed="activePreset === '20m'" data-form-preset="20m"
        @click="applyMatchesPreset()"
      >
        Last 20 vs prior 20
      </button>
      <button
        v-if="samePoint"
        type="button" class="form-preset" :class="{ active: activePreset === 'same-point' }"
        :aria-pressed="activePreset === 'same-point'" data-form-preset="same-point"
        @click="applySamePointPreset()"
      >
        Same point last season
      </button>
    </div>

    <!-- Pairing controls. -->
    <div class="form-controls">
      <div class="form-pairby" role="group" aria-label="Pair windows by">
        <button
          type="button" class="form-pairby-btn" :class="{ active: pairBy === 'time' }"
          :aria-pressed="pairBy === 'time'" data-form-pairby="time"
          @click="setPairBy('time')"
        >
          By time
        </button>
        <button
          type="button" class="form-pairby-btn" :class="{ active: pairBy === 'matches' }"
          :aria-pressed="pairBy === 'matches'" data-form-pairby="matches"
          @click="setPairBy('matches')"
        >
          By matches
        </button>
      </div>

      <template v-if="pairBy === 'time'">
        <label class="form-field">
          <span class="form-field-label">This period from</span>
          <input v-model="bFrom" type="date" data-form-b-from class="form-date" @change="onManualEdit()">
        </label>
        <label class="form-field">
          <span class="form-field-label">to</span>
          <input
            v-model="bTo" type="date" data-form-b-to class="form-date"
            aria-label="This period to" @change="onManualEdit()"
          >
        </label>

        <div class="form-mirror">
          <span v-if="aLocked" class="form-mirror-label" data-form-a-window>
            <span aria-hidden="true">🔒</span> vs previous period · {{ windowLabel(aWindow) }}
          </span>
          <template v-else>
            <label class="form-field">
              <span class="form-field-label">Baseline from</span>
              <input v-model="aFrom" type="date" data-form-a-from class="form-date" @change="onManualEdit()">
            </label>
            <label class="form-field">
              <span class="form-field-label">to</span>
              <input
                v-model="aTo" type="date" data-form-a-to class="form-date"
                aria-label="Baseline to" @change="onManualEdit()"
              >
            </label>
          </template>
          <button
            type="button" class="form-mirror-toggle" data-form-b-unlock
            @click="aLocked = !aLocked; onManualEdit()"
          >
            {{ aLocked ? 'Unlock baseline' : 'Mirror previous period' }}
          </button>
        </div>
        <p v-if="bWindow && aLocked === false && aWindow && windowDays(aWindow) !== windowDays(bWindow)" class="form-note-inline">
          Unequal windows — rates stay comparable; counts don't.
        </p>
      </template>

      <template v-else>
        <label class="form-field">
          <span class="form-field-label">Window size</span>
          <select v-model="nPick" data-form-n class="form-select" @change="onManualEdit()">
            <option v-for="n in N_OPTIONS" :key="n" :value="n">{{ n }} matches</option>
          </select>
        </label>
      </template>

      <div class="form-conds">
        <label class="form-field">
          <span class="form-field-label">Baseline condition</span>
          <select v-model="condKindA" data-form-cond-a class="form-select">
            <option value="any">Any game</option>
            <option value="solo">Solo (no group)</option>
            <option value="member">Duo with…</option>
            <option value="weekday">Weekdays</option>
            <option value="weekend">Weekends</option>
            <option value="role:tank">Tank games</option>
            <option value="role:dps">DPS games</option>
            <option value="role:support">Support games</option>
            <option value="hero">Hero…</option>
          </select>
        </label>
        <label v-if="condKindA === 'member'" class="form-field">
          <span class="form-field-label">Member</span>
          <select v-model="condMemberA" class="form-select" aria-label="Baseline duo member">
            <option value="">Pick a member</option>
            <option v-for="m in availableMembers" :key="m" :value="m">{{ m }}</option>
          </select>
        </label>
        <label v-if="condKindA === 'hero'" class="form-field">
          <span class="form-field-label">Hero</span>
          <select v-model="condHeroA" class="form-select" aria-label="Baseline hero">
            <option value="">Pick a hero</option>
            <option v-for="h in availableHeroes" :key="h" :value="h">{{ ow.heroDisplayName(h) }}</option>
          </select>
        </label>

        <label class="form-field">
          <span class="form-field-label">This period's condition</span>
          <select v-model="condKindB" data-form-cond-b class="form-select">
            <option value="any">Any game</option>
            <option value="solo">Solo (no group)</option>
            <option value="member">Duo with…</option>
            <option value="weekday">Weekdays</option>
            <option value="weekend">Weekends</option>
            <option value="role:tank">Tank games</option>
            <option value="role:dps">DPS games</option>
            <option value="role:support">Support games</option>
            <option value="hero">Hero…</option>
          </select>
        </label>
        <label v-if="condKindB === 'member'" class="form-field">
          <span class="form-field-label">Member</span>
          <select v-model="condMemberB" class="form-select" aria-label="This period's duo member">
            <option value="">Pick a member</option>
            <option v-for="m in availableMembers" :key="m" :value="m">{{ m }}</option>
          </select>
        </label>
        <label v-if="condKindB === 'hero'" class="form-field">
          <span class="form-field-label">Hero</span>
          <select v-model="condHeroB" class="form-select" aria-label="This period's hero">
            <option value="">Pick a hero</option>
            <option v-for="h in availableHeroes" :key="h" :value="h">{{ ow.heroDisplayName(h) }}</option>
          </select>
        </label>
      </div>
    </div>

    <p class="sr-only" aria-live="polite">
      {{ liveSummary }}
    </p>

    <!-- The verdict — the answer, before the evidence. -->
    <div class="form-verdict-card" :data-form-verdict-word="verdict.word">
      <p class="eyebrow form-verdict-eyebrow">
        Verdict
      </p>
      <p
        class="form-verdict-word"
        :class="{
          'is-sharper': verdict.word === 'SHARPER',
          'is-slipping': verdict.word === 'SLIPPING',
          'is-early': verdict.word === 'TOO EARLY TO CALL',
        }"
        data-form-verdict
      >
        {{ verdict.word }}
      </p>
      <p v-if="verdict.movers.length" class="form-verdict-movers">
        <span v-for="m in verdict.movers" :key="m" data-form-mover class="form-verdict-mover">{{ m }}</span>
      </p>
      <p v-else-if="verdict.word === 'TOO EARLY TO CALL'" class="form-verdict-movers form-verdict-hint">
        Fewer than 5 decisive games in a window — play a few more, then check back.
      </p>

      <div class="form-sparks">
        <figure class="form-spark">
          <figcaption class="form-spark-label">
            {{ labelA }}
          </figcaption>
          <svg
            v-if="sparkA" data-form-spark-a class="form-spark-svg" role="img"
            :aria-label="sparkAriaA"
            :viewBox="`0 0 ${SPARK_W} ${SPARK_H}`"
          >
            <line class="form-spark-mid" :x1="0" :x2="SPARK_W" :y1="midY" :y2="midY" />
            <polyline class="form-spark-line is-a" :points="sparkA" />
          </svg>
          <p v-else data-form-spark-a class="form-spark-empty">
            No decisive games
          </p>
        </figure>
        <figure class="form-spark">
          <figcaption class="form-spark-label">
            {{ labelB }}
          </figcaption>
          <svg
            v-if="sparkB" data-form-spark-b class="form-spark-svg" role="img"
            :aria-label="sparkAriaB"
            :viewBox="`0 0 ${SPARK_W} ${SPARK_H}`"
          >
            <line class="form-spark-mid" :x1="0" :x2="SPARK_W" :y1="midY" :y2="midY" />
            <polyline class="form-spark-line is-b" :points="sparkB" />
          </svg>
          <p v-else data-form-spark-b class="form-spark-empty">
            No decisive games
          </p>
        </figure>
      </div>
    </div>

    <CompareTable
      :sections="sections"
      :label-a="labelA"
      :label-b="labelB"
      :drillable="drillable"
      data-form-table
      @drill="onDrill"
    />

    <p v-if="pair.untimed > 0" data-form-untimed class="form-note">
      {{ pair.untimed }} match{{ pair.untimed === 1 ? '' : 'es' }} without a derivable date
      {{ pair.untimed === 1 ? 'is' : 'are' }} excluded from both windows.
    </p>
    <p v-if="anyLowSample" class="form-note form-note-faint">
      <span class="form-lown">n&lt;5</span> marks a window with fewer than five decisive
      matches — its win rate swings on a single result.
    </p>
  </div>
</template>

<style scoped src="./form-compare-view.css"></style>

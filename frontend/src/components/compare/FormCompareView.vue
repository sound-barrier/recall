<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'

import type { MatchRecord } from '@/api-client'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import { useOWData } from '@/composables/shared/useOWData'
import { useMatchesDossier } from '@/composables/matches/useMatchesDossier'
import { matchesLeaverHandling } from '@/composables/matches/narrowPredicates'
import { useFormDrill } from '@/composables/compare/useFormDrill'
import { buildSeasonMetrics, topHeroDisplay } from '@/components/compare/compareSnapshot'
import CompareTable from '@/components/compare/CompareTable.vue'
import { compareSeasons, type ComparisonRow } from '@/match/match-compare-helpers'
import { judgeForm } from '@/match/match-form-verdict'
import { leaverRate, sessionCount } from '@/match/match-momentum-helpers'
import {
  buildCondition, conditionDrillable, conditionPredicate, mirrorPreviousWindow, pairByMatches,
  pairByTime, rollingWinrate, samePointWindows, trailingWindow, windowDays,
  type FormPair, type TimeWindow,
} from '@/match/match-form-slices'

// FORM — the Compare tab's second mode. Two adjacent windows of play — this
// period vs the previous one (mirrored to the same length) or the last N
// matches vs the N before — judged into a verdict word with the biggest
// movers, a facing sparkline pair for each period's shape, and the shared
// A/B/Δ evidence table below. Cells drill through to the Matches tab.

const matchesStore = useMatchesStore()
const ow = useOWData()
const { weekStart } = storeToRefs(useSettingsStore())
const { drill } = useFormDrill()

// ─── Pairing state ────────────────────────────────────────────────────────
const pairBy = ref<'time' | 'matches'>('time')
const initial = trailingWindow(7)
const bFrom = ref(initial.from)
const bTo = ref(initial.to)
// The baseline mirrors the picked period by default; unlocking allows any A.
const aLocked = ref(true)
const aFrom = ref('')
const aTo = ref('')
const nPick = ref('20')
const activePreset = ref('7d')

const N_OPTIONS = ['10', '20', '50'] as const

function applyTrailingPreset(days: number, key: string) {
  const w = trailingWindow(days)
  pairBy.value = 'time'
  aLocked.value = true
  bFrom.value = w.from
  bTo.value = w.to
  activePreset.value = key
}

function applyMatchesPreset() {
  pairBy.value = 'matches'
  nPick.value = '20'
  activePreset.value = '20m'
}

const samePoint = computed(() => samePointWindows(ow.seasons.value))

function applySamePointPreset() {
  const w = samePoint.value
  if (!w) return
  pairBy.value = 'time'
  aLocked.value = false
  bFrom.value = w.b.from
  bTo.value = w.b.to
  aFrom.value = w.a.from
  aTo.value = w.a.to
  activePreset.value = 'same-point'
}

function onManualEdit() {
  activePreset.value = ''
}

// Switching pairing modes only clears the preset highlight when the mode
// actually changes — re-clicking the active mode is a no-op.
function setPairBy(next: 'time' | 'matches') {
  if (pairBy.value === next) return
  pairBy.value = next
  onManualEdit()
}

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

const bWindow = computed<TimeWindow | null>(() => {
  if (!bFrom.value || !bTo.value || bFrom.value > bTo.value) return null
  return { from: bFrom.value, to: bTo.value }
})

const aWindow = computed<TimeWindow | null>(() => {
  const b = bWindow.value
  if (aLocked.value) return b ? mirrorPreviousWindow(b) : null
  if (!aFrom.value || !aTo.value || aFrom.value > aTo.value) return null
  return { from: aFrom.value, to: aTo.value }
})

const pair = computed<FormPair>(() => {
  if (pairBy.value === 'matches') {
    return pairByMatches(visibleRecords.value, Number(nPick.value))
  }
  const b = bWindow.value
  const a = aWindow.value
  if (!b || !a) return { a: [], b: [], aWindow: a, bWindow: b, untimed: 0 }
  return pairByTime(visibleRecords.value, b, a)
})

const recordsA = computed<MatchRecord[]>(() => pair.value.a.filter(conditionPredicate(condA.value, ow.heroRole)))
const recordsB = computed<MatchRecord[]>(() => pair.value.b.filter(conditionPredicate(condB.value, ow.heroRole)))

const leaverHandling = matchesStore.matchesNarrow.leaverHandling
const dossierA = useMatchesDossier(recordsA, leaverHandling, ow.heroRole, weekStart)
const dossierB = useMatchesDossier(recordsB, leaverHandling, ow.heroRole, weekStart)
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

// ─── Sparklines ───────────────────────────────────────────────────────────
const SPARK_W = 220
const SPARK_H = 56
const SPARK_PAD = 6

function sparkPoints(values: number[]): string {
  if (values.length === 0) return ''
  if (values.length === 1) {
    const y = SPARK_PAD + ((100 - values[0]!) / 100) * (SPARK_H - 2 * SPARK_PAD)
    return `0,${y.toFixed(1)} ${SPARK_W},${y.toFixed(1)}`
  }
  const step = SPARK_W / (values.length - 1)
  return values
    .map((v, i) => `${(i * step).toFixed(1)},${(SPARK_PAD + ((100 - v) / 100) * (SPARK_H - 2 * SPARK_PAD)).toFixed(1)}`)
    .join(' ')
}

// A text equivalent of the line's shape (WCAG 1.1.1) — the label carries the
// data the chart shows, not just its name.
function sparkAria(values: number[], which: string): string {
  if (values.length === 0) return ''
  const first = values[0]!
  const last = values[values.length - 1]!
  return `Rolling win rate ${which}: ${first}% to ${last}% across ${values.length} decisive games`
}

const sparkValuesA = computed(() => rollingWinrate(recordsA.value))
const sparkValuesB = computed(() => rollingWinrate(recordsB.value))
const sparkA = computed(() => sparkPoints(sparkValuesA.value))
const sparkB = computed(() => sparkPoints(sparkValuesB.value))
const sparkAriaA = computed(() => sparkAria(sparkValuesA.value, 'in the baseline window'))
const sparkAriaB = computed(() => sparkAria(sparkValuesB.value, 'this period'))
const midY = SPARK_PAD + (SPARK_H - 2 * SPARK_PAD) / 2

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

function drillable(row: ComparisonRow, col: 'a' | 'b'): boolean {
  if (NON_DRILLABLE_ROWS.has(row.key)) return false
  const window = col === 'a' ? pair.value.aWindow : pair.value.bWindow
  const cond = col === 'a' ? condA.value : condB.value
  const display = col === 'a' ? row.aDisplay : row.bDisplay
  if (window === null || display === '—' || !conditionDrillable(cond)) return false
  // A role row under a DIFFERENT role condition can't be expressed — the
  // narrow's role picks OR together, so two picks widen instead of intersect.
  const rowRole = ROLE_ROW_KEYS[row.key]
  if (rowRole && cond.kind === 'role' && cond.role !== rowRole) return false
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

<style scoped>
.form-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin: 1.1rem 0 0.8rem;
}

.form-preset {
  appearance: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: var(--type-xs);
  letter-spacing: 0.03em;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
}

.form-preset:hover {
  border-color: var(--accent);
  color: var(--text);
}

.form-preset.active {
  background: color-mix(in srgb, var(--accent) 22%, var(--surface-2));
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  color: var(--text);
}

.form-preset:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.form-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.7rem 1rem;
  margin-bottom: 0.4rem;
}

.form-pairby {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.form-pairby-btn {
  appearance: none;
  border: 0;
  background: var(--surface-2);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: var(--type-xs);
  letter-spacing: 0.04em;
  padding: 0.45rem 0.7rem;
  cursor: pointer;
}

.form-pairby-btn + .form-pairby-btn {
  border-left: 1px solid var(--border);
}

.form-pairby-btn.active {
  background: color-mix(in srgb, var(--accent) 22%, var(--surface-2));
  color: var(--text);
}

.form-pairby-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.form-field-label {
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.form-date,
.form-select {
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-2);
  color: var(--text);
  font-size: var(--type-lg);
}

.form-mirror {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.6rem;
}

.form-mirror-label {
  font-family: var(--mono);
  font-size: var(--type-sm);
  color: var(--text-dim);
  padding-bottom: 0.45rem;
}

.form-mirror-toggle {
  appearance: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--type-2xs);
  padding: 0.3rem 0.55rem;
  cursor: pointer;
}

.form-mirror-toggle:hover {
  color: var(--text);
  border-color: var(--accent);
}

.form-mirror-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.form-conds {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem 1rem;
}

.form-note-inline {
  flex-basis: 100%;
  margin: 0;
  font-family: var(--mono);
  font-size: var(--type-xs);
  color: var(--text-faint);
}

/* ─── Verdict card — the one loud element on the page ─── */
.form-verdict-card {
  margin: 1rem 0 0.4rem;
  padding: 1.1rem 1.2rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, transparent) 0%, transparent 45%),
    var(--surface);
}

.form-verdict-eyebrow {
  margin: 0;
}

.form-verdict-word {
  margin: 0.15rem 0 0;
  font-family: var(--display);
  font-size: clamp(2.2rem, 6vw, 3.4rem);
  line-height: 1;
  letter-spacing: 0.04em;
  color: var(--text);
}

.form-verdict-word.is-sharper {
  color: var(--win);
}

.form-verdict-word.is-slipping {
  color: var(--loss);
}

.form-verdict-word.is-early {
  color: var(--text-faint);
}

.form-verdict-movers {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 1rem;
  margin: 0.5rem 0 0;
  font-family: var(--mono);
  font-size: var(--type-sm);
  color: var(--text-dim);
}

.form-verdict-hint {
  font-style: italic;
  color: var(--text-faint);
}

.form-sparks {
  display: flex;
  flex-wrap: wrap;
  gap: 1.2rem 2rem;
  margin-top: 0.9rem;
}

.form-spark {
  margin: 0;
  flex: 1 1 220px;
  max-width: 320px;
}

.form-spark-label {
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.05em;
  color: var(--text-faint);
  margin-bottom: 0.25rem;
}

.form-spark-svg {
  display: block;
  width: 100%;
  height: 56px;
}

.form-spark-mid {
  stroke: color-mix(in srgb, var(--text-faint) 35%, transparent);
  stroke-width: 0.5;
  stroke-dasharray: 3 3;
}

.form-spark-line {
  fill: none;
  stroke-width: 1.8;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.form-spark-line.is-a {
  stroke: color-mix(in srgb, var(--text-faint) 80%, var(--text));
}

.form-spark-line.is-b {
  stroke: var(--accent);
}

.form-spark-empty {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--type-xs);
  font-style: italic;
  color: var(--text-faint);
  padding: 1.2rem 0;
}

.form-note {
  margin: 0.7rem 0 0;
  font-size: var(--type-sm);
  color: var(--text-dim);
}

.form-note-faint {
  color: var(--text-faint);
}

.form-lown {
  display: inline-block;
  padding: 0 0.28rem;
  border-radius: var(--radius);
  background: var(--loss-soft);
  color: var(--text);
  border: 1px solid var(--loss-line);
  font-family: var(--mono);
  font-size: var(--type-2xs);
}
</style>

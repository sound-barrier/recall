<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import type { MatchRecord } from '@/api-client'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import { useOWData } from '@/composables/shared/useOWData'
import { useMatchesDossier } from '@/composables/matches/useMatchesDossier'
import { seasonForMatch } from '@/match/match-season-helpers'
import { matchesLeaverHandling } from '@/composables/matches/narrowPredicates'
import { compareSeasons, type ComparisonSection } from '@/match/match-compare-helpers'
import { buildSeasonMetrics, topHeroDisplay } from '@/components/compare/compareSnapshot'
import CompareTable from '@/components/compare/CompareTable.vue'
import FormCompareView from '@/components/compare/FormCompareView.vue'

// THE COMPARE TAB — two modes over one comparison engine:
//   Seasons — two competitive seasons side by side, each column a full dossier
//     aggregation over that season's matches (placed by START time), rendered
//     as sectioned A / B / Δ rows.
//   Form — two adjacent windows of play (this period vs the previous, or the
//     last N matches vs the N before) judged into a verdict word; lives in
//     FormCompareView.

const mode = ref<'seasons' | 'form'>('seasons')

const matchesStore = useMatchesStore()
const ow = useOWData()
const { seasons, seasonsByChapter } = ow
const { weekStart } = storeToRefs(useSettingsStore())

const enoughSeasons = computed(() => seasons.value.length >= 2)

// ─── Picks + scope ──────────────────────────────────────────────────────
const pickA = ref('')
const pickB = ref('')
// Default to the two most recent seasons once reference data lands; never
// clobber a pick the user already made.
watch(seasons, (list) => {
  if (list.length < 2) return
  if (!pickA.value) pickA.value = list.at(-2)?.name ?? ''
  if (!pickB.value) pickB.value = list.at(-1)?.name ?? ''
}, { immediate: true })

const scope = ref<'full' | 'filtered'>('full')

// Full-scope source. Beyond hidden-stripping, honour the leaver 'Hide' setting
// and the unknown-map default here — the narrow applies both in the filtered
// scope (its leaver clause + includeUnknown=false), so applying them keeps the
// two scopes consistent (otherwise 'Hide' would count MORE games than 'Drop
// from tally', and full-scope would count unknown-map rows filtered-scope drops).
const visibleRecords = computed<MatchRecord[]>(() =>
  matchesStore.records.filter(
    (r) => !r.hidden
      && !!r.data?.map
      && matchesLeaverHandling(r, matchesStore.matchesNarrow.leaverHandling.value),
  ),
)
const sourceRecords = computed<MatchRecord[]>(() =>
  scope.value === 'filtered'
    ? matchesStore.matchesNarrow.narrowedExceptSeason.value
    : visibleRecords.value,
)

const sameSeason = computed(() => pickA.value !== '' && pickA.value === pickB.value)

// ─── Per-season record refs → dossiers ──────────────────────────────────
const recordsA = computed<MatchRecord[]>(() =>
  pickA.value ? sourceRecords.value.filter((r) => seasonForMatch(r, seasons.value)?.name === pickA.value) : [],
)
const recordsB = computed<MatchRecord[]>(() =>
  pickB.value ? sourceRecords.value.filter((r) => seasonForMatch(r, seasons.value)?.name === pickB.value) : [],
)

const leaverHandling = matchesStore.matchesNarrow.leaverHandling
const dossierA = useMatchesDossier(recordsA, leaverHandling, ow.heroRole, weekStart)
const dossierB = useMatchesDossier(recordsB, leaverHandling, ow.heroRole, weekStart)

const topHeroA = dossierA.topByCount({ getter: (r) => r.data?.hero || undefined, limit: 1 })
const topHeroB = dossierB.topByCount({ getter: (r) => r.data?.hero || undefined, limit: 1 })

const sections = computed<ComparisonSection[]>(() =>
  compareSeasons(
    buildSeasonMetrics(dossierA, recordsA.value, topHeroDisplay(topHeroA.value, ow), ow),
    buildSeasonMetrics(dossierB, recordsB.value, topHeroDisplay(topHeroB.value, ow), ow),
  ),
)

const excludedCount = computed(() =>
  sourceRecords.value.filter((r) => seasonForMatch(r, seasons.value) === null).length,
)
const anyLowSample = computed(() => sections.value.some((s) => s.rows.some((r) => r.lowSample)))

// Screen-reader announcement of the current comparison — the table reflows on a
// pick/scope change with no focus move, which assistive tech won't otherwise
// notice (WCAG 4.1.3 Status Messages).
const liveSummary = computed(() => {
  if (!enoughSeasons.value || !pickA.value || !pickB.value) return ''
  const scopeText = scope.value === 'filtered' ? 'current filter' : 'full seasons'
  return `Comparing ${pickA.value} versus ${pickB.value}, ${scopeText}.`
})
</script>

<template>
  <section
    id="panel-compare"
    role="tabpanel"
    aria-labelledby="tab-compare"
    tabindex="-1"
    class="settings compare-view"
  >
    <header class="settings-intro">
      <p class="settings-eyebrow">
        Comparison
      </p>
      <h2 class="settings-heading">
        Compare
      </h2>
      <p class="compare-desc">
        {{ mode === 'seasons'
          ? 'Pick two seasons to see how your performance changed — record, win rate, combat, time played, and more, side by side.'
          : 'Compare this stretch of play against the one before it — by calendar period or by match count — and get a verdict.' }}
      </p>
    </header>

    <div class="compare-mode" role="group" aria-label="Comparison mode">
      <button
        type="button"
        class="compare-scope-btn"
        :class="{ active: mode === 'seasons' }"
        :aria-pressed="mode === 'seasons'"
        data-compare-mode="seasons"
        @click="mode = 'seasons'"
      >
        Seasons
      </button>
      <button
        type="button"
        class="compare-scope-btn"
        :class="{ active: mode === 'form' }"
        :aria-pressed="mode === 'form'"
        data-compare-mode="form"
        @click="mode = 'form'"
      >
        Form
      </button>
    </div>

    <template v-if="mode === 'seasons'">
      <div v-if="!enoughSeasons" class="empty">
        <div class="empty-mark" aria-hidden="true">
          ◑
        </div>
        <p class="empty-title">
          Not enough seasons yet.
        </p>
        <p class="empty-sub">
          Comparison needs at least two competitive seasons. Seasons ship in
          <code>seasons.yaml</code> and refresh via <strong>Check for updates</strong>.
        </p>
      </div>

      <template v-else>
        <div class="compare-controls">
          <label class="compare-field">
            <span class="compare-field-label">Baseline (A)</span>
            <select v-model="pickA" data-compare-a class="compare-select">
              <optgroup v-for="grp in seasonsByChapter" :key="grp.chapter" :label="grp.chapter">
                <option v-for="s in grp.seasons" :key="s.name" :value="s.name">{{ s.name }}</option>
              </optgroup>
            </select>
          </label>

          <span class="compare-vs" aria-hidden="true">vs</span>

          <label class="compare-field">
            <span class="compare-field-label">Compared (B)</span>
            <select v-model="pickB" data-compare-b class="compare-select">
              <optgroup v-for="grp in seasonsByChapter" :key="grp.chapter" :label="grp.chapter">
                <option v-for="s in grp.seasons" :key="s.name" :value="s.name">{{ s.name }}</option>
              </optgroup>
            </select>
          </label>

          <div class="compare-scope" role="group" aria-label="Comparison scope">
            <button
              type="button"
              class="compare-scope-btn"
              :class="{ active: scope === 'full' }"
              :aria-pressed="scope === 'full'"
              data-compare-scope="full"
              @click="scope = 'full'"
            >
              Full seasons
            </button>
            <button
              type="button"
              class="compare-scope-btn"
              :class="{ active: scope === 'filtered' }"
              :aria-pressed="scope === 'filtered'"
              data-compare-scope="filtered"
              @click="scope = 'filtered'"
            >
              Current filter
            </button>
          </div>
        </div>

        <p class="sr-only" aria-live="polite">
          {{ liveSummary }}
        </p>

        <p v-if="scope === 'filtered'" class="compare-scope-hint">
          Comparing the current Matches filter, applied within each season.
        </p>
        <p v-if="sameSeason" role="alert" class="compare-scope-hint compare-warn">
          Pick two different seasons to see a meaningful comparison.
        </p>

        <CompareTable :sections="sections" :label-a="pickA" :label-b="pickB" />

        <p v-if="excludedCount > 0" data-compare-excluded class="compare-note">
          {{ excludedCount }} match{{ excludedCount === 1 ? '' : 'es' }}
          {{ excludedCount === 1 ? "doesn't" : "don't" }} fall in any season (no derivable
          date, or played outside every season window) and {{ excludedCount === 1 ? 'is' : 'are' }}
          excluded from both columns.
        </p>
        <p v-if="anyLowSample" class="compare-note compare-note-faint">
          <span class="compare-lown">n&lt;5</span> marks a season with fewer than five decisive
          matches — its win rate swings on a single result.
        </p>
      </template>
    </template>

    <FormCompareView v-else />
  </section>
</template>

<style scoped>
.compare-view {
  max-width: 60rem;
}

.compare-desc {
  margin: 0.35rem 0 0;
  color: var(--text-dim);
  font-size: 0.85rem;
}

.compare-mode {
  display: inline-flex;
  margin-top: 1.1rem;
  border: 1px solid var(--border);
  border-radius: 3px;
  overflow: hidden;
}

.compare-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem 1rem;
  margin: 1.2rem 0 0.4rem;
}

.compare-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 14rem;
  flex: 1 1 14rem;
}

.compare-field-label {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.compare-select {
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 0.85rem;
}

.compare-vs {
  padding-bottom: 0.5rem;
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-faint);
}

.compare-scope {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 3px;
  overflow: hidden;
}

.compare-scope-btn {
  appearance: none;
  border: 0;
  background: var(--surface-2);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  padding: 0.45rem 0.7rem;
  cursor: pointer;
}

.compare-scope-btn + .compare-scope-btn {
  border-left: 1px solid var(--border);
}

.compare-scope-btn.active {
  background: color-mix(in srgb, var(--accent) 22%, var(--surface-2));
  color: var(--text);
}

.compare-scope-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.compare-scope-hint {
  margin: 0.1rem 0 0;
  font-family: var(--mono);
  font-size: 0.66rem;
  color: var(--text-faint);
}

.compare-warn {
  color: var(--loss);
}

.compare-note {
  margin: 0.7rem 0 0;
  font-size: 0.72rem;
  color: var(--text-dim);
}

.compare-note-faint {
  color: var(--text-faint);
}

.compare-note code {
  font-family: var(--mono);
  font-size: 0.9em;
}

.compare-lown {
  display: inline-block;
  margin-left: 0.3rem;
  padding: 0 0.28rem;
  border-radius: 2px;

  /* Mirrors CompareTable's badge treatment — --text on the loss tint clears
     WCAG-AA on every theme where a --loss glyph at this size would not. */
  background: var(--loss-soft);
  color: var(--text);
  border: 1px solid var(--loss-line);
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.02em;
}
</style>

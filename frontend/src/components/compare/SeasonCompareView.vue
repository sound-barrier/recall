<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import type { MatchRecord } from '@/api-client'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import { useOWData } from '@/composables/shared/useOWData'
import { useMatchesDossier, type MatchesDossier } from '@/composables/matches/useMatchesDossier'
import type { BreakdownEntry, RoleBreakdownEntry } from '@/composables/matches/useMatchesDossier.types'
import { seasonForMatch } from '@/match/match-season-helpers'
import { matchesLeaverHandling } from '@/composables/matches/narrowPredicates'
import {
  bestHeroByRole, heroPoolsByRole, modeBreakdown, playlistCounts, queueCounts,
  topMap as topMapOf, worstHero, type Role,
} from '@/match/match-compare-aggregate'
import { compareSeasons, type ComparisonRow, type ComparisonSection, type RateStat, type SeasonMetrics } from '@/match/match-compare-helpers'

// A hero qualifies as best/worst for a season only with at least this many
// decisive games, so a 1-game 100% hero can't win — matches the win-rate
// low-sample floor (LOW_SAMPLE_N).
const HERO_MIN_GAMES = 5

// SEASON COMPARISON — two seasons side by side, each column a full dossier
// aggregation over that season's matches, rendered as A / B / Δ rows. A scope
// toggle switches the source between the whole corpus (full seasons) and the
// current Matches narrow (its season clause skipped, so the two columns aren't
// collapsed to one). Untimed matches belong to no season and are surfaced as an
// excluded count rather than silently dropped.

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
// here — the narrow's leaver clause already drops hidden-leaver matches in the
// filtered scope, so applying it keeps both scopes consistent (otherwise 'Hide'
// would count MORE games than 'Drop from tally' in full scope).
const visibleRecords = computed<MatchRecord[]>(() =>
  matchesStore.records.filter(
    (r) => !r.hidden && matchesLeaverHandling(r, matchesStore.matchesNarrow.leaverHandling.value),
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

// ─── Snapshot → sections ────────────────────────────────────────────────
function topHeroDisplay(entries: BreakdownEntry[]): string | null {
  const top = entries[0]
  return top ? ow.heroDisplayName(top.key) : null
}

function roleStat(roles: RoleBreakdownEntry[], key: Role): RateStat {
  const entry = roles.find((r) => r.key === key)
  return { winrate: entry?.winrate ?? 0, games: entry?.total ?? 0 }
}

function snapshot(d: MatchesDossier, records: MatchRecord[], topHero: string | null): SeasonMetrics {
  const wld = d.wld.value
  const kda = d.averageKDA.value
  const time = d.totalTimePlayed.value
  const roles = d.topRoles.value
  const pools = heroPoolsByRole(records, ow.heroRole)
  const best = bestHeroByRole(records, ow.heroRole, ow.heroDisplayName, HERO_MIN_GAMES)
  const playlists = playlistCounts(records)
  const queues = queueCounts(records)
  return {
    games: wld.total, wins: wld.w, losses: wld.l, draws: wld.d,
    competitiveGames: playlists.competitive, quickPlayGames: playlists.quickplay,
    roleQueueGames: queues.role, openQueueGames: queues.open,
    winratePct: d.winrate.value,
    elimsPer10: kda ? kda.eliminations : null,
    deathsPer10: kda ? kda.deaths : null,
    assistsPer10: kda ? kda.assists : null,
    minutesPlayed: time.minutes, timeLabel: time.label,
    longestWinStreak: d.longestWinStreak.value,
    longestLosingStreak: d.longestLosingStreak.value,
    roleTank: roleStat(roles, 'tank'), roleDps: roleStat(roles, 'dps'), roleSupport: roleStat(roles, 'support'),
    heroPoolTank: pools.tank, heroPoolDps: pools.dps, heroPoolSupport: pools.support,
    bestHeroTank: best.tank, bestHeroDps: best.dps, bestHeroSupport: best.support,
    topMap: topMapOf(records, ow.mapDisplayName),
    modes: modeBreakdown(records, ow.mapGameMode),
    topHero,
    worstHero: worstHero(records, ow.heroDisplayName, HERO_MIN_GAMES),
  }
}

const sections = computed<ComparisonSection[]>(() =>
  compareSeasons(
    snapshot(dossierA, recordsA.value, topHeroDisplay(topHeroA.value)),
    snapshot(dossierB, recordsB.value, topHeroDisplay(topHeroB.value)),
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

function deltaClass(r: ComparisonRow) {
  return {
    'is-improved': r.outcome === 'improved',
    'is-regressed': r.outcome === 'regressed',
    'is-muted': r.outcome === 'neutral' || r.outcome === 'even' || r.outcome === null,
  }
}
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
        Season Comparison
      </p>
      <h2 class="settings-heading">
        Compare seasons
      </h2>
      <p class="compare-desc">
        Pick two seasons to see how your performance changed — record, win rate,
        combat, time played, and more, side by side.
      </p>
    </header>

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

      <table class="compare-table" aria-label="Season comparison metrics">
        <thead>
          <tr>
            <th scope="col" class="compare-metric-head">
              Metric
            </th>
            <th scope="col">
              {{ pickA }}
            </th>
            <th scope="col">
              {{ pickB }}
            </th>
            <th scope="col" class="compare-delta-head">
              Δ&nbsp;(B&nbsp;vs&nbsp;A)
            </th>
          </tr>
        </thead>
        <tbody v-for="section in sections" :key="section.title" :data-compare-section="section.title">
          <tr class="compare-section-row">
            <th scope="colgroup" colspan="4" class="compare-section-head">
              {{ section.title }}
            </th>
          </tr>
          <tr v-for="r in section.rows" :key="r.key" :data-compare-row="r.key">
            <th scope="row" class="compare-metric">
              {{ r.label }}
            </th>
            <td class="compare-a" :class="{ 'is-winner': r.outcome === 'regressed' }">
              {{ r.aDisplay }}
            </td>
            <td class="compare-b" :class="{ 'is-winner': r.outcome === 'improved' }">
              {{ r.bDisplay }}
            </td>
            <td class="compare-delta" :class="deltaClass(r)">
              <span v-if="r.delta">{{ r.delta }}</span>
              <span v-else class="compare-dash" aria-hidden="true">·</span>
              <span
                v-if="r.lowSample"
                class="compare-lown"
                title="Fewer than 5 decisive matches in one season — treat the rate as noisy"
              >n&lt;5</span>
            </td>
          </tr>
        </tbody>
      </table>

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

.compare-table {
  width: 100%;
  margin-top: 1rem;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.compare-table th,
.compare-table td {
  padding: 0.42rem 0.6rem;
  border-bottom: 1px solid var(--border);
  text-align: right;
}

.compare-table thead th {
  font-family: var(--mono);
  font-size: 0.64rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
  border-bottom: 1px solid var(--border);
  vertical-align: bottom;
}

.compare-metric-head,
.compare-metric {
  text-align: left;
}

.compare-section-head {
  padding: 1.1rem 0.6rem 0.35rem;
  text-align: left;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 700;

  /* --accent-text is the theme-aware accent-for-text token (dark orange in Day,
     bright in dark themes) — the raw --accent orange is sub-AA on light surfaces. */
  color: var(--accent-text);
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
}

.compare-metric {
  font-weight: 500;
  color: var(--text-dim);
}

.compare-a,
.compare-b {
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.compare-a.is-winner,
.compare-b.is-winner {
  background: color-mix(in srgb, var(--win) 14%, transparent);
  font-weight: 600;
}

.compare-delta {
  font-family: var(--mono);
  font-size: 0.78rem;
  white-space: nowrap;
}

.compare-delta.is-improved {
  color: var(--win);
}

.compare-delta.is-regressed {
  color: var(--loss);
}

.compare-delta.is-muted {
  color: var(--text-faint);
}

.compare-dash {
  color: var(--text-faint);
}

.compare-lown {
  display: inline-block;
  margin-left: 0.3rem;
  padding: 0 0.28rem;
  border-radius: 2px;

  /* Soft-loss fill + line carries the "warning" semantic, but the TEXT is the
     high-contrast --text so it clears WCAG-AA on every theme — a --loss-coloured
     glyph on the loss tint falls to ~3.9:1 at this size in the Day theme. */
  background: var(--loss-soft);
  color: var(--text);
  border: 1px solid var(--loss-line);
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.02em;
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

@media (width <= 560px) {
  .compare-table {
    font-size: 0.78rem;
  }

  .compare-table th,
  .compare-table td {
    padding: 0.38rem 0.4rem;
  }
}
</style>

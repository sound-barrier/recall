import type { MatchRecord } from '@/api-client'
import type { SearchClause } from '@/match/search-query'
import type { LeaverPick, MatchesNarrowState, SourcePick, ThrowerPick } from '@/composables/matches/narrow/matchesNarrow.types'
import {
  matchesDateRange,
  matchesHero,
  matchesLeaverHandling,
  matchesMembers,
  matchesModifiers,
  matchesAnySide,
  matchesPickedSet,
  matchesReviewedBy,
  matchesQueueType,
  matchesPlayMode,
  matchesPoolSide,
  matchesRole,
  matchesSearch,
  matchesSinceAnchor,
  matchesPickedSeason,
  matchesSource,
  matchesTags,
} from '@/composables/matches/narrow/narrowPredicates'

// The narrow-clause REGISTRY: one entry per filter dimension, declaring
// everything the consumers used to re-enumerate by hand — the row
// predicate, the "is it restricting?" test, the chip-count contribution,
// the smart-empty label, and the single-clause reset. Adding a dimension
// is ONE entry here (plus its predicate in narrowPredicates.ts and its
// state field + preset key, guarded by the preset-completeness test);
// the old shape spread the same fact across five switch/if ladders in
// useMatchesNarrow and shipped a bug when the preset pair was missed.

export type ClauseId = 'search' | 'dateRange' | 'maps' | 'gameModes' | 'roles'
  | 'results' | 'heroes' | 'tags' | 'members' | 'reviewedBy' | 'queues'
  | 'playModes' | 'sources' | 'leaver' | 'leaverSide' | 'throwerSide' | 'modifiers' | 'ranks'
  | 'sinceAnchor' | 'minPlay' | 'includeUnknown' | 'season' | 'poolSide' | 'reviewSet'

// Per-pass inputs the predicates need beyond the raw state: the parsed
// search clauses, the hero→role resolver, the pre-resolved anchor floor
// (per-row lookup would be O(n²)), and the active skip set — which ONLY
// the heroes clause reads, because minPlay is a modifier of the hero
// picks rather than an independent gate (see that entry).
export interface ClauseCtx {
  searchClauses: SearchClause[]
  heroRole: (hero: string | null | undefined) => string
  anchorFloor: string | null
  // Resolves the picked season NAME to its [startMs, endMs) window (null =
  // unknown name). From useOWData; kept out of narrow state so presets store
  // only the name and the window re-resolves from live reference data.
  seasonWindow: (name: string) => { startMs: number; endMs: number } | null
  skip: ReadonlySet<ClauseId>
}

export interface ClauseSpec {
  id: ClauseId
  // True when the clause currently restricts the set — drives the
  // smart-empty suggestion list.
  restricts(s: MatchesNarrowState): boolean
  // Row gate. Runs only when the clause isn't skipped.
  passes(r: MatchRecord, s: MatchesNarrowState, ctx: ClauseCtx): boolean
  // Human label for the suggestion chip ("map rialto", "3 tag picks").
  label(s: MatchesNarrowState): string
  // Lift THIS restriction only (the suggestion's single click). Not the
  // same as reset-to-default: includeUnknown clears to true.
  clear(s: MatchesNarrowState): void
  // Contribution to the active-clause chip count. Defaults to
  // restricts ? 1 : 0; picked-set clauses count per pick, minPlay counts
  // each threshold, includeUnknown counts the non-default ON state.
  chips?(s: MatchesNarrowState): number
}

// Label helper for the picked-set clauses' shared "one pick names it,
// several count it" pattern.
function pickedLabel(picked: Set<string>, one: (v: string) => string, many: string): string {
  return picked.size === 1 ? one([...picked][0]!) : `${picked.size} ${many}`
}

// Ordered as the old passesNarrow chain evaluated (cheap gates first);
// the order is also the tiebreak-stable base for suggestion sorting.
// How each provenance bucket reads when it is the only one picked. A lookup
// rather than a ternary: this was `x === 'manual' ? 'user-entered' : 'edited'`,
// which meant the third bucket ('replay') silently described itself as
// "edited only" — a chip lying about what it filtered. A registry keyed by the
// discriminant is the shape that makes a new bucket a new ROW rather than a
// new branch somebody has to remember to add.
const SOURCE_PICK_LABELS: Partial<Record<SourcePick, string>> = {
  manual: 'user-entered',
  ocr_edited: 'edited',
  replay: 'replay-review',
}

export const NARROW_CLAUSES: readonly ClauseSpec[] = [
  {
    id: 'includeUnknown',
    restricts: (s) => !s.includeUnknown.value,
    passes: (r, s) => s.includeUnknown.value || !!r.data?.map,
    label: () => 'unknown-map exclusion',
    clear: (s) => { s.includeUnknown.value = true },
    // The chip count tracks the NON-DEFAULT state (toggle ON), while the
    // restriction is the default OFF — different consumers, different truths.
    chips: (s) => (s.includeUnknown.value ? 1 : 0),
  },
  {
    id: 'search',
    restricts: (s) => s.searchText.value.trim() !== '',
    passes: (r, _s, ctx) => matchesSearch(r, ctx.searchClauses),
    label: (s) => `search "${s.searchText.value.trim()}"`,
    clear: (s) => { s.searchText.value = '' },
  },
  {
    id: 'dateRange',
    restricts: (s) => !!s.customFrom.value || !!s.customTo.value || s.pickedRange.value !== 'all',
    passes: (r, s) =>
      matchesDateRange(r, {
        from: s.customFrom.value,
        to: s.customTo.value,
        fromTime: s.customFromTime.value,
        toTime: s.customToTime.value,
      }),
    label: () => 'date range',
    clear: (s) => {
      s.pickedRange.value = 'all'
      s.customFrom.value = ''
      s.customTo.value = ''
      s.customFromTime.value = ''
      s.customToTime.value = ''
    },
  },
  {
    id: 'maps',
    restricts: (s) => s.pickedMaps.value.size > 0,
    passes: (r, s) => matchesPickedSet(r.data?.map, s.pickedMaps.value),
    label: (s) => pickedLabel(s.pickedMaps.value, (v) => `map ${v}`, 'map picks'),
    clear: (s) => { s.pickedMaps.value = new Set() },
    chips: (s) => s.pickedMaps.value.size,
  },
  {
    id: 'gameModes',
    restricts: (s) => s.pickedGameModes.value.size > 0,
    passes: (r, s) => matchesPickedSet(r.data?.game_mode, s.pickedGameModes.value),
    label: (s) => pickedLabel(s.pickedGameModes.value, (v) => `game-mode ${v}`, 'game-mode picks'),
    clear: (s) => { s.pickedGameModes.value = new Set() },
    chips: (s) => s.pickedGameModes.value.size,
  },
  {
    id: 'roles',
    restricts: (s) => s.pickedRoles.value.size > 0,
    passes: (r, s, ctx) => matchesRole(r, s.pickedRoles.value, ctx.heroRole),
    label: (s) => pickedLabel(s.pickedRoles.value, (v) => `role ${v}`, 'role picks'),
    clear: (s) => { s.pickedRoles.value = new Set() },
    chips: (s) => s.pickedRoles.value.size,
  },
  {
    id: 'results',
    restricts: (s) => s.pickedResults.value.size > 0,
    passes: (r, s) => matchesPickedSet(r.data?.result, s.pickedResults.value),
    label: (s) => pickedLabel(s.pickedResults.value, (v) => `result ${v}`, 'result picks'),
    clear: (s) => { s.pickedResults.value = new Set() },
    chips: (s) => s.pickedResults.value.size,
  },
  {
    // The heroes clause owns the min-play thresholds: they qualify the
    // picked heroes' play time, and are inert without picks (matchesHero
    // short-circuits on an empty set). Skipping 'minPlay' therefore
    // zeroes the thresholds while KEEPING the picks — the old fused
    // skip dropped the picks too, which made the smart-empty
    // "remove min-play" suggestion over-promise.
    id: 'heroes',
    restricts: (s) => s.pickedHeroes.value.size > 0,
    passes: (r, s, ctx) => matchesHero(
      r,
      s.pickedHeroes.value,
      ctx.skip.has('minPlay') ? 0 : s.minPlayMinutes.value,
      ctx.skip.has('minPlay') ? 0 : s.minPlayPercent.value,
    ),
    label: (s) => pickedLabel(s.pickedHeroes.value, (v) => `hero ${v}`, 'hero picks'),
    clear: (s) => { s.pickedHeroes.value = new Set() },
    chips: (s) => s.pickedHeroes.value.size,
  },
  {
    // No independent gate (see the heroes entry) — this clause exists so
    // the thresholds are individually countable, liftable, and skippable.
    // It only restricts when it can actually gate something: a threshold
    // with no hero picks filters nothing, so suggesting its removal
    // would be a lie.
    id: 'minPlay',
    restricts: (s) => (s.minPlayMinutes.value > 0 || s.minPlayPercent.value > 0)
      && s.pickedHeroes.value.size > 0,
    passes: () => true,
    label: () => 'minimum play threshold',
    clear: (s) => {
      s.minPlayMinutes.value = 0
      s.minPlayPercent.value = 0
    },
    chips: (s) => (s.minPlayMinutes.value > 0 ? 1 : 0) + (s.minPlayPercent.value > 0 ? 1 : 0),
  },
  {
    id: 'tags',
    restricts: (s) => s.pickedTags.value.size > 0,
    passes: (r, s) => matchesTags(r, s.pickedTags.value),
    label: (s) => pickedLabel(s.pickedTags.value, (v) => `tag #${v}`, 'tag picks'),
    clear: (s) => { s.pickedTags.value = new Set() },
    chips: (s) => s.pickedTags.value.size,
  },
  {
    id: 'members',
    restricts: (s) => s.pickedMembers.value.size > 0,
    passes: (r, s) => matchesMembers(r, s.pickedMembers.value),
    label: (s) => pickedLabel(s.pickedMembers.value, (v) => `with ${v}`, 'teammates'),
    clear: (s) => { s.pickedMembers.value = new Set() },
    chips: (s) => s.pickedMembers.value.size,
  },
  {
    id: 'reviewedBy',
    restricts: (s) => s.pickedReviewedBy.value.size > 0,
    passes: (r, s) => matchesReviewedBy(r, s.pickedReviewedBy.value),
    label: () => 'reviewed-by filter',
    clear: (s) => { s.pickedReviewedBy.value = new Set() },
    chips: (s) => s.pickedReviewedBy.value.size,
  },
  {
    id: 'queues',
    restricts: (s) => s.pickedQueues.value.size > 0,
    passes: (r, s) => matchesQueueType(r, s.pickedQueues.value),
    label: () => 'queue-type filter',
    clear: (s) => { s.pickedQueues.value = new Set() },
    chips: (s) => s.pickedQueues.value.size,
  },
  {
    id: 'playModes',
    restricts: (s) => s.pickedPlayModes.value.size > 0,
    passes: (r, s) => matchesPlayMode(r, s.pickedPlayModes.value),
    label: () => 'play-mode filter',
    clear: (s) => { s.pickedPlayModes.value = new Set() },
    chips: (s) => s.pickedPlayModes.value.size,
  },
  {
    id: 'sources',
    restricts: (s) => s.pickedSources.value.size > 0,
    passes: (r, s) => matchesSource(r, s.pickedSources.value),
    label: (s) => s.pickedSources.value.size === 1
      ? `${SOURCE_PICK_LABELS[[...s.pickedSources.value][0]!] ?? 'provenance'} only`
      : 'provenance filter',
    clear: (s) => { s.pickedSources.value = new Set() },
    chips: (s) => s.pickedSources.value.size,
  },
  {
    id: 'sinceAnchor',
    // Only counts when both legs are set — an active toggle pointing at
    // no anchor is a no-op; no point suggesting or counting it.
    restricts: (s) => s.sinceAnchorActive.value && s.anchorKey.value !== '',
    passes: (r, _s, ctx) => matchesSinceAnchor(r, ctx.anchorFloor),
    label: () => 'since-anchor floor',
    clear: (s) => { s.sinceAnchorActive.value = false },
  },
  {
    id: 'season',
    restricts: (s) => s.pickedSeason.value !== '',
    passes: (r, s, ctx) => matchesPickedSeason(r, s.pickedSeason.value, ctx.seasonWindow),
    label: (s) => `season ${s.pickedSeason.value}`,
    clear: (s) => { s.pickedSeason.value = '' },
  },
  {
    id: 'leaver',
    restricts: (s) => s.leaverHandling.value !== 'include',
    passes: (r, s) => matchesLeaverHandling(r, s.leaverHandling.value),
    label: () => 'leaver handling',
    clear: (s) => { s.leaverHandling.value = 'include' },
  },
  {
    id: 'leaverSide',
    restricts: (s) => s.pickedLeavers.value.size > 0,
    passes: (r, s) => matchesAnySide(r.annotation?.leavers, s.pickedLeavers.value as Set<string>),
    label: (s) => pickedLabel(
      s.pickedLeavers.value as Set<string>,
      (v) => `${v as LeaverPick} leaver`,
      'leaver sides',
    ),
    clear: (s) => { s.pickedLeavers.value = new Set() },
    chips: (s) => s.pickedLeavers.value.size,
  },
  {
    // Independent of leaverSide AND of leaverHandling: a thrown match still
    // counts in the W/L tally, so there is no thrower equivalent of the
    // 3-way handling control.
    id: 'throwerSide',
    restricts: (s) => s.pickedThrowers.value.size > 0,
    passes: (r, s) => matchesAnySide(r.annotation?.throwers, s.pickedThrowers.value as Set<string>),
    label: (s) => pickedLabel(
      s.pickedThrowers.value as Set<string>,
      (v) => `${v as ThrowerPick} thrower`,
      'thrower sides',
    ),
    clear: (s) => { s.pickedThrowers.value = new Set() },
    chips: (s) => s.pickedThrowers.value.size,
  },
  {
    id: 'modifiers',
    restricts: (s) => s.pickedModifiers.value.size > 0,
    passes: (r, s) => matchesModifiers(r, s.pickedModifiers.value),
    label: (s) => pickedLabel(s.pickedModifiers.value, (v) => `modifier ${v}`, 'modifier picks'),
    clear: (s) => { s.pickedModifiers.value = new Set() },
    chips: (s) => s.pickedModifiers.value.size,
  },
  {
    id: 'ranks',
    restricts: (s) => s.pickedRanks.value.size > 0,
    passes: (r, s) => matchesPickedSet(r.data?.rank, s.pickedRanks.value),
    label: (s) => pickedLabel(s.pickedRanks.value, (v) => `rank ${v}`, 'rank picks'),
    clear: (s) => { s.pickedRanks.value = new Set() },
    chips: (s) => s.pickedRanks.value.size,
  },
  {
    // "Show these matches" from a review card — a snapshotted key set worn
    // as one clause, so the set is visible and clearable like any filter.
    id: 'reviewSet',
    restricts: (s) => s.reviewSetFilter.value !== null,
    passes: (r, s) => s.reviewSetFilter.value?.keys.has(r.match_key) ?? true,
    label: (s) => s.reviewSetFilter.value?.label ?? 'review matches',
    clear: (s) => { s.reviewSetFilter.value = null },
  },
  {
    // The Hero Pool band's In-pool / Out-of-pool selection. Not a picked-set:
    // one nullable filter carrying the snapshotted pool keys + chosen side.
    id: 'poolSide',
    restricts: (s) => s.poolFilter.value !== null,
    passes: (r, s) => matchesPoolSide(r, s.poolFilter.value),
    label: (s) => (s.poolFilter.value?.side === 'off' ? 'off-pool games' : 'on-pool games'),
    clear: (s) => { s.poolFilter.value = null },
  },
]

import { computed, type Ref } from 'vue'
import type { MatchRecord } from '@/api-client'
import type {
  MatchesNarrowState,
  PresetRange,
  ReviewedByPick,
  QueuePick,
  PlayModePick,
  SourcePick,
  LeaverPick,
} from '@/composables/matches/matchesNarrow.types'
import {
  matchesDateRange,
  matchesHero,
  matchesLeaverHandling,
  matchesMembers,
  matchesModifiers,
  matchesPickedSet,
  matchesReviewedBy,
  matchesQueueType,
  matchesPlayMode,
  matchesSearch,
  matchesSinceAnchor,
  matchesSource,
  matchesTags,
} from '@/composables/matches/narrowPredicates'
import { useSearchClauses } from '@/composables/matches/useSearchClauses'
import { TIER_ORDER, FILTERABLE_MODIFIERS, RESULT_MODIFIERS } from '@/match/match-trends-helpers'

// Owns every filter dimension for the Matches set-workspace narrow
// panel. Extracted from MatchesView so the filter math is testable
// in isolation — the integrated UI tests can then focus on layout +
// keyboard contract rather than re-asserting "filter by map drops
// the right records" for every dimension.
//
// Two design choices worth flagging:
//
//   1. State is owned IN the composable as plain refs rather than
//      injected from the caller. That keeps the surface area of the
//      "narrow panel" feature self-contained — App.vue doesn't need
//      to thread 15 refs + setters into MatchesView. The trade-off:
//      this composable can't share its state with other views (e.g.
//      Analysis) without a re-export pattern. Acceptable today;
//      revisit if Analysis ever needs the same scope.
//
//   2. Hidden-by-default for unknown-map records (no `data.map`).
//      They live in the Unknown tab; surfacing them in the Matches
//      dossier conflates "what map was that?" with "what's my
//      record on Junkertown?". The narrow panel exposes an
//      `includeUnknown` toggle for one-off investigations.

// The narrow filter-dimension types + the state factory live in sibling modules
// (matchesNarrow.types / matchesNarrow.state); re-export them so existing
// `from './useMatchesNarrow'` imports stay stable.
export type {
  PresetRange,
  ReviewedByPick,
  QueuePick,
  PlayModePick,
  SourcePick,
  LeaverPick,
  MatchesNarrowState,
} from '@/composables/matches/matchesNarrow.types'
export { createMatchesNarrowState } from '@/composables/matches/matchesNarrow.state'

function toggleSet(set: Set<string>, value: string): Set<string> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function toggleGameModedSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)].filter((v) => v != null && v !== '') as T[]
}

function daysAgoISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export function useMatchesNarrow(
  records: Readonly<Ref<MatchRecord[]>>,
  state: MatchesNarrowState,
) {
  const {
    searchText, pickedMaps, pickedGameModes, pickedHeroes,
    pickedRoles, pickedResults, pickedTags, pickedMembers, pickedReviewedBy,
    pickedQueues, pickedPlayModes, pickedSources,
    pickedLeavers, pickedModifiers, pickedRanks,
    pickedRange, customFrom, customTo,
    leaverHandling, minPlayMinutes, minPlayPercent, includeUnknown,
    anchorKey, sinceAnchorActive,
  } = state

  // Parse the raw search box into scoped clauses once. The narrow
  // filter gates on these, and they're re-exposed so the leaf rows can
  // highlight the matched substrings on the surfaces they show.
  const { searchClauses } = useSearchClauses(searchText)

  // ── Pickers ─────────────────────────────────────────────
  const pickMap        = (v: string) => { pickedMaps.value     = toggleSet(pickedMaps.value,     v) }
  const pickGameMode    = (v: string) => { pickedGameModes.value = toggleSet(pickedGameModes.value, v) }
  const pickHero       = (v: string) => { pickedHeroes.value   = toggleSet(pickedHeroes.value,   v) }
  const pickRole       = (v: string) => { pickedRoles.value    = toggleSet(pickedRoles.value,    v) }
  const pickResult     = (v: string) => { pickedResults.value  = toggleSet(pickedResults.value,  v) }
  const pickTag        = (v: string) => { pickedTags.value     = toggleSet(pickedTags.value,     v) }
  const pickMember     = (v: string) => { pickedMembers.value  = toggleSet(pickedMembers.value,  v) }
  const pickReviewedBy = (v: ReviewedByPick) => {
    pickedReviewedBy.value = toggleGameModedSet(pickedReviewedBy.value, v)
  }
  const pickQueue = (v: QueuePick) => {
    pickedQueues.value = toggleGameModedSet(pickedQueues.value, v)
  }
  const pickPlayMode = (v: PlayModePick) => {
    pickedPlayModes.value = toggleGameModedSet(pickedPlayModes.value, v)
  }
  const pickSource = (v: SourcePick) => {
    pickedSources.value = toggleGameModedSet(pickedSources.value, v)
  }
  const pickLeaver   = (v: LeaverPick) => { pickedLeavers.value   = toggleGameModedSet(pickedLeavers.value, v) }
  const pickModifier = (v: string)     => { pickedModifiers.value = toggleSet(pickedModifiers.value, v) }
  const pickRank     = (v: string)     => { pickedRanks.value     = toggleSet(pickedRanks.value,     v) }

  function pickRange(v: PresetRange) {
    pickedRange.value = v
    if (v === 'all') {
      customFrom.value = ''
      customTo.value = ''
    } else if (v !== 'custom') {
      const days = v === '7d' ? 7 : v === '30d' ? 30 : 90
      customFrom.value = daysAgoISO(days)
      customTo.value = ''
    }
  }

  function resetNarrow() {
    searchText.value          = ''
    pickedMaps.value          = new Set()
    pickedGameModes.value      = new Set()
    pickedHeroes.value        = new Set()
    pickedRoles.value         = new Set()
    pickedResults.value       = new Set()
    pickedTags.value          = new Set()
    pickedMembers.value       = new Set()
    pickedReviewedBy.value    = new Set()
    pickedQueues.value        = new Set()
    pickedPlayModes.value     = new Set()
    pickedSources.value       = new Set()
    pickedLeavers.value       = new Set()
    pickedModifiers.value     = new Set()
    pickedRanks.value         = new Set()
    pickedRange.value         = 'all'
    customFrom.value          = ''
    customTo.value            = ''
    leaverHandling.value      = 'include'
    minPlayMinutes.value      = 0
    minPlayPercent.value      = 0
    includeUnknown.value      = false
    sinceAnchorActive.value   = false
    // anchorKey is owned by useMatchAnchor (persisted across sessions)
    // — narrow-panel reset toggles the FILTER off but doesn't clear
    // the anchor itself.
  }

  // ── Active-clause introspection ─────────────────────────
  const activeClauseCount = computed(() => {
    let n = 0
    if (searchText.value.trim()) n++
    if (customFrom.value || customTo.value) n++
    else if (pickedRange.value !== 'all') n++
    n += pickedMaps.value.size
    n += pickedGameModes.value.size
    n += pickedHeroes.value.size
    n += pickedRoles.value.size
    n += pickedResults.value.size
    n += pickedTags.value.size
    n += pickedMembers.value.size
    n += pickedReviewedBy.value.size
    n += pickedQueues.value.size
    n += pickedPlayModes.value.size
    n += pickedSources.value.size
    n += pickedLeavers.value.size
    n += pickedModifiers.value.size
    n += pickedRanks.value.size
    if (leaverHandling.value !== 'include') n++
    if (minPlayMinutes.value > 0) n++
    if (minPlayPercent.value > 0) n++
    if (includeUnknown.value) n++
    // "Since anchor" only counts when both legs are set — an active
    // toggle pointing at no anchor (or a stale anchor) is a no-op
    // anyway, no point inflating the chip count.
    if (sinceAnchorActive.value && anchorKey.value !== '') n++
    return n
  })
  const anyNarrow = computed(() => activeClauseCount.value > 0)

  // ── Available-option universes (full corpus, NOT narrowed) ──
  const availableMaps     = computed(() => uniq(records.value.map((r) => r.data?.map  ?? '')).sort())
  const availableGameModes = computed(() => uniq(records.value.map((r) => r.data?.game_mode ?? '')).sort())
  const availableHeroes   = computed(() => {
    const set = new Set<string>()
    for (const r of records.value) {
      if (r.data?.hero) set.add(r.data.hero)
      for (const hp of r.data?.heroes_played ?? []) {
        if (hp.hero) set.add(hp.hero)
      }
    }
    return [...set].sort()
  })
  const availableRoles    = computed(() => uniq(records.value.map((r) => r.data?.role   ?? '')).sort())
  const availableResults  = computed(() => uniq(records.value.map((r) => r.data?.result ?? '')).sort())
  const availableTags     = computed(() => {
    const set = new Set<string>()
    for (const r of records.value) {
      for (const t of r.annotation?.tags ?? []) if (t) set.add(t)
    }
    return [...set].sort()
  })
  const availableMembers  = computed(() => {
    const set = new Set<string>()
    for (const r of records.value) {
      for (const m of r.annotation?.members ?? []) if (m) set.add(m)
    }
    return [...set].sort()
  })
  // Leaver sides / modifiers / ranks present in the corpus, in canonical
  // order (not alphabetical) — fixed enums, so we only surface chips for
  // values the user has actually recorded but keep their meaningful order.
  const LEAVER_SIDE_ORDER: LeaverPick[] = ['self', 'team', 'enemy']
  const availableLeaverSides = computed<LeaverPick[]>(() => {
    const set = new Set<string>()
    for (const r of records.value) { const l = r.annotation?.leaver; if (l) set.add(l) }
    return LEAVER_SIDE_ORDER.filter((s) => set.has(s))
  })
  const availableModifiers = computed<string[]>(() => {
    const set = new Set<string>()
    for (const r of records.value) {
      for (const m of r.data?.modifiers ?? []) if (m && !RESULT_MODIFIERS.has(m)) set.add(m)
    }
    const known = FILTERABLE_MODIFIERS.filter((m) => set.has(m))
    const extra = [...set].filter((m) => !(FILTERABLE_MODIFIERS as readonly string[]).includes(m)).sort()
    return [...known, ...extra]
  })
  const availableRanks = computed<string[]>(() => {
    const set = new Set<string>()
    for (const r of records.value) { const rank = r.data?.rank; if (rank) set.add(rank) }
    const order = TIER_ORDER as readonly string[]
    return [...set].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  })

  // ── Filtering ──────────────────────────────────────────
  const narrowedRecords = computed(() => {
    // Soft-deleted (hidden) records drop out unconditionally. The
    // new MatchesView doesn't surface a "show hidden" toggle —
    // users unhide via the detail panel. Filtering here lets
    // `selection` auto-close when the open match gets hidden,
    // since narrowedRecords stops containing it.
    let base = records.value.filter((r) => !r.hidden)
    if (!includeUnknown.value) {
      base = base.filter((r) => !!r.data?.map)
    }

    // Resolve the "since this anchor match" floor ONCE — looking up
    // the anchor record per-row would be O(n²). The floor is an ISO
    // parsed_at string (lexicographic compare = chronological).
    // Unset / stale anchor (anchor key not found in the corpus)
    // disables the filter — same end-state as if the user hadn't
    // checked it. Tests pin both cases.
    let anchorFloor: string | null = null
    if (sinceAnchorActive.value && anchorKey.value !== '') {
      const anchor = records.value.find((r) => r.match_key === anchorKey.value)
      if (anchor && anchor.parsed_at) {
        anchorFloor = anchor.parsed_at
      }
    }

    const heroMin = minPlayMinutes.value
    const heroPct = minPlayPercent.value
    const fromBound = customFrom.value
    const toBound = customTo.value
    const maps = pickedMaps.value
    const gameModes = pickedGameModes.value
    const roles = pickedRoles.value
    const results = pickedResults.value
    const heroes = pickedHeroes.value
    const tags = pickedTags.value
    const members = pickedMembers.value
    const reviewed = pickedReviewedBy.value
    const queues = pickedQueues.value
    const playModes = pickedPlayModes.value
    const sources = pickedSources.value
    const leaver = leaverHandling.value
    const leavers = pickedLeavers.value as Set<string>
    const modifiers = pickedModifiers.value
    const ranks = pickedRanks.value

    // Each predicate gates its own dimension; `every` short-circuits.
    // Adding a new dimension is one more line here + one helper in
    // narrowPredicates.ts — the giant monolithic arrow this replaces
    // was 85-complexity and impossible to unit-test in isolation.
    return base.filter((r) => {
      if (!r.data) return false
      return matchesSearch(r, searchClauses.value)
        && matchesDateRange(r, fromBound, toBound)
        && matchesPickedSet(r.data.map, maps)
        && matchesPickedSet(r.data.game_mode, gameModes)
        && matchesPickedSet(r.data.role, roles)
        && matchesPickedSet(r.data.result, results)
        && matchesHero(r, heroes, heroMin, heroPct)
        && matchesTags(r, tags)
        && matchesMembers(r, members)
        && matchesReviewedBy(r, reviewed)
        && matchesQueueType(r, queues)
        && matchesPlayMode(r, playModes)
        && matchesSource(r, sources)
        && matchesSinceAnchor(r, anchorFloor)
        && matchesLeaverHandling(r, leaver)
        && matchesPickedSet(r.annotation?.leaver, leavers)
        && matchesModifiers(r, modifiers)
        && matchesPickedSet(r.data.rank, ranks)
    })
  })

  // ── Smart-empty suggestions ──────────────────────────────────
  //
  // When the user's active narrow excludes every record, surface
  // the 1-2 single-click "Try removing X" suggestions that would
  // bring the most records back. For each active clause, count how
  // many records pass every OTHER predicate; the clause whose
  // removal surfaces the most records is the most-restrictive.
  //
  // Returns an empty array when:
  //   - the narrow isn't actually empty (no suggestion needed),
  //   - the user has no active clauses (nothing to suggest), or
  //   - dropping any one clause STILL leaves zero records (no
  //     single clause is the culprit; the suggestion would be a lie).
  type ClauseId = 'search' | 'dateRange' | 'maps' | 'gameModes' | 'roles'
                | 'results' | 'heroes' | 'tags' | 'members' | 'reviewedBy' | 'queues'
                | 'playModes' | 'sources' | 'leaver' | 'leaverSide' | 'modifiers' | 'ranks'
                | 'sinceAnchor' | 'minPlay' | 'includeUnknown'

  interface ClauseSuggestion {
    clauseId: ClauseId
    label: string         // "search 'clutch'" / "map filter (3 picks)"
    wouldSurface: number  // records that surface when this clause is dropped
    clear: () => void     // single-click reset for this clause only
  }

  function matchesNarrowExcept(r: MatchRecord, omit: ClauseId | null): boolean {
    if (!r.data) return false
    const fromBound = customFrom.value
    const toBound   = customTo.value
    const maps      = pickedMaps.value
    const gameModes  = pickedGameModes.value
    const roles     = pickedRoles.value
    const results   = pickedResults.value
    const heroes    = pickedHeroes.value
    const heroMin   = minPlayMinutes.value
    const heroPct   = minPlayPercent.value
    const tags      = pickedTags.value
    const members   = pickedMembers.value
    const reviewed  = pickedReviewedBy.value
    const queues    = pickedQueues.value
    const playModes = pickedPlayModes.value
    const sources   = pickedSources.value
    const leaver    = leaverHandling.value
    const leavers   = pickedLeavers.value as Set<string>
    const modifiers = pickedModifiers.value
    const ranks     = pickedRanks.value
    let anchorFloor: string | null = null
    if (omit !== 'sinceAnchor' && sinceAnchorActive.value && anchorKey.value !== '') {
      const anchor = records.value.find((x) => x.match_key === anchorKey.value)
      if (anchor?.parsed_at) anchorFloor = anchor.parsed_at
    }
    if (omit !== 'search'         && !matchesSearch(r, searchClauses.value)) return false
    if (omit !== 'dateRange'      && !matchesDateRange(r, fromBound, toBound)) return false
    if (omit !== 'maps'           && !matchesPickedSet(r.data.map, maps)) return false
    if (omit !== 'gameModes'       && !matchesPickedSet(r.data.game_mode, gameModes)) return false
    if (omit !== 'roles'          && !matchesPickedSet(r.data.role, roles)) return false
    if (omit !== 'results'        && !matchesPickedSet(r.data.result, results)) return false
    if (omit !== 'heroes'         && omit !== 'minPlay' && !matchesHero(r, heroes, heroMin, heroPct)) return false
    if (omit !== 'tags'           && !matchesTags(r, tags)) return false
    if (omit !== 'members'        && !matchesMembers(r, members)) return false
    if (omit !== 'reviewedBy'     && !matchesReviewedBy(r, reviewed)) return false
    if (omit !== 'queues'         && !matchesQueueType(r, queues)) return false
    if (omit !== 'playModes'      && !matchesPlayMode(r, playModes)) return false
    if (omit !== 'sources'        && !matchesSource(r, sources)) return false
    if (omit !== 'sinceAnchor'    && !matchesSinceAnchor(r, anchorFloor)) return false
    if (omit !== 'leaver'         && !matchesLeaverHandling(r, leaver)) return false
    if (omit !== 'leaverSide'     && !matchesPickedSet(r.annotation?.leaver, leavers)) return false
    if (omit !== 'modifiers'      && !matchesModifiers(r, modifiers)) return false
    if (omit !== 'ranks'          && !matchesPickedSet(r.data.rank, ranks)) return false
    return true
  }

  // ── Cross-widget "narrow minus self" record sets ─────────────────
  // A dossier band (Geography / Hero×Game-Mode) reads everything EXCEPT its own
  // filter dimensions, so it reflects the OTHER bands' picks — they indirectly
  // affect each other — without collapsing from its own selection. Same predicate
  // chain as narrowedRecords with the named dimensions skipped (mirrors
  // matchesNarrowExcept, but gates on a Set so two dimensions can drop at once).
  function narrowExcluding(skip: ReadonlySet<ClauseId>): MatchRecord[] {
    let base = records.value.filter((r) => !r.hidden)
    if (!includeUnknown.value) base = base.filter((r) => !!r.data?.map)
    let anchorFloor: string | null = null
    if (!skip.has('sinceAnchor') && sinceAnchorActive.value && anchorKey.value !== '') {
      const anchor = records.value.find((r) => r.match_key === anchorKey.value)
      if (anchor?.parsed_at) anchorFloor = anchor.parsed_at
    }
    return base.filter((r) => {
      if (!r.data) return false
      if (!skip.has('search')      && !matchesSearch(r, searchClauses.value)) return false
      if (!skip.has('dateRange')   && !matchesDateRange(r, customFrom.value, customTo.value)) return false
      if (!skip.has('maps')        && !matchesPickedSet(r.data.map, pickedMaps.value)) return false
      if (!skip.has('gameModes')   && !matchesPickedSet(r.data.game_mode, pickedGameModes.value)) return false
      if (!skip.has('roles')       && !matchesPickedSet(r.data.role, pickedRoles.value)) return false
      if (!skip.has('results')     && !matchesPickedSet(r.data.result, pickedResults.value)) return false
      if (!skip.has('heroes')      && !matchesHero(r, pickedHeroes.value, minPlayMinutes.value, minPlayPercent.value)) return false
      if (!skip.has('tags')        && !matchesTags(r, pickedTags.value)) return false
      if (!skip.has('members')     && !matchesMembers(r, pickedMembers.value)) return false
      if (!skip.has('reviewedBy')  && !matchesReviewedBy(r, pickedReviewedBy.value)) return false
      if (!skip.has('queues')      && !matchesQueueType(r, pickedQueues.value)) return false
      if (!skip.has('playModes')   && !matchesPlayMode(r, pickedPlayModes.value)) return false
      if (!skip.has('sources')     && !matchesSource(r, pickedSources.value)) return false
      if (!skip.has('sinceAnchor') && !matchesSinceAnchor(r, anchorFloor)) return false
      if (!skip.has('leaver')      && !matchesLeaverHandling(r, leaverHandling.value)) return false
      if (!skip.has('leaverSide')  && !matchesPickedSet(r.annotation?.leaver, pickedLeavers.value as Set<string>)) return false
      if (!skip.has('modifiers')   && !matchesModifiers(r, pickedModifiers.value)) return false
      if (!skip.has('ranks')       && !matchesPickedSet(r.data.rank, pickedRanks.value)) return false
      return true
    })
  }
  const narrowedExceptMapsRoles = computed(() => narrowExcluding(new Set<ClauseId>(['maps', 'roles'])))
  const narrowedExceptHeroesGameModes = computed(() => narrowExcluding(new Set<ClauseId>(['heroes', 'gameModes'])))

  function activeClauses(): ClauseId[] {
    const out: ClauseId[] = []
    if (searchText.value.trim())                                    out.push('search')
    if (customFrom.value || customTo.value || pickedRange.value !== 'all') out.push('dateRange')
    if (pickedMaps.value.size > 0)                                  out.push('maps')
    if (pickedGameModes.value.size > 0)                              out.push('gameModes')
    if (pickedRoles.value.size > 0)                                 out.push('roles')
    if (pickedResults.value.size > 0)                               out.push('results')
    if (pickedHeroes.value.size > 0)                                out.push('heroes')
    if (pickedTags.value.size > 0)                                  out.push('tags')
    if (pickedMembers.value.size > 0)                               out.push('members')
    if (pickedReviewedBy.value.size > 0)                            out.push('reviewedBy')
    if (pickedQueues.value.size > 0)                                out.push('queues')
    if (pickedPlayModes.value.size > 0)                             out.push('playModes')
    if (pickedSources.value.size > 0)                               out.push('sources')
    if (leaverHandling.value !== 'include')                         out.push('leaver')
    if (pickedLeavers.value.size > 0)                               out.push('leaverSide')
    if (pickedModifiers.value.size > 0)                             out.push('modifiers')
    if (pickedRanks.value.size > 0)                                 out.push('ranks')
    if (sinceAnchorActive.value && anchorKey.value !== '')          out.push('sinceAnchor')
    if (minPlayMinutes.value > 0 || minPlayPercent.value > 0)       out.push('minPlay')
    return out
  }

  function clauseLabel(c: ClauseId): string {
    switch (c) {
      case 'search':         return `search "${searchText.value.trim()}"`
      case 'dateRange':      return 'date range'
      case 'maps':           return pickedMaps.value.size === 1
        ? `map ${[...pickedMaps.value][0]}`
        : `${pickedMaps.value.size} map picks`
      case 'gameModes':       return pickedGameModes.value.size === 1
        ? `game-mode ${[...pickedGameModes.value][0]}`
        : `${pickedGameModes.value.size} game-mode picks`
      case 'roles':          return pickedRoles.value.size === 1
        ? `role ${[...pickedRoles.value][0]}`
        : `${pickedRoles.value.size} role picks`
      case 'results':        return pickedResults.value.size === 1
        ? `result ${[...pickedResults.value][0]}`
        : `${pickedResults.value.size} result picks`
      case 'heroes':         return pickedHeroes.value.size === 1
        ? `hero ${[...pickedHeroes.value][0]}`
        : `${pickedHeroes.value.size} hero picks`
      case 'tags':           return pickedTags.value.size === 1
        ? `tag #${[...pickedTags.value][0]}`
        : `${pickedTags.value.size} tag picks`
      case 'members':        return pickedMembers.value.size === 1
        ? `with ${[...pickedMembers.value][0]}`
        : `${pickedMembers.value.size} teammates`
      case 'reviewedBy':     return 'reviewed-by filter'
      case 'queues':         return 'queue-type filter'
      case 'playModes':      return 'play-mode filter'
      case 'sources':        return pickedSources.value.size === 1
        ? `${[...pickedSources.value][0] === 'manual' ? 'user-entered' : 'edited'} only`
        : 'provenance filter'
      case 'leaver':         return 'leaver handling'
      case 'leaverSide':     return pickedLeavers.value.size === 1
        ? `${[...pickedLeavers.value][0]} leaver`
        : `${pickedLeavers.value.size} leaver sides`
      case 'modifiers':      return pickedModifiers.value.size === 1
        ? `modifier ${[...pickedModifiers.value][0]}`
        : `${pickedModifiers.value.size} modifier picks`
      case 'ranks':          return pickedRanks.value.size === 1
        ? `rank ${[...pickedRanks.value][0]}`
        : `${pickedRanks.value.size} rank picks`
      case 'sinceAnchor':    return 'since-anchor floor'
      case 'minPlay':        return 'minimum play threshold'
      case 'includeUnknown': return 'unknown-map exclusion'
    }
  }

  function clearClause(c: ClauseId) {
    switch (c) {
      case 'search':         searchText.value = ''; break
      case 'dateRange':      pickedRange.value = 'all'; customFrom.value = ''; customTo.value = ''; break
      case 'maps':           pickedMaps.value = new Set(); break
      case 'gameModes':       pickedGameModes.value = new Set(); break
      case 'roles':          pickedRoles.value = new Set(); break
      case 'results':        pickedResults.value = new Set(); break
      case 'heroes':         pickedHeroes.value = new Set(); break
      case 'tags':           pickedTags.value = new Set(); break
      case 'members':        pickedMembers.value = new Set(); break
      case 'reviewedBy':     pickedReviewedBy.value = new Set(); break
      case 'queues':         pickedQueues.value = new Set(); break
      case 'playModes':      pickedPlayModes.value = new Set(); break
      case 'sources':        pickedSources.value = new Set(); break
      case 'leaver':         leaverHandling.value = 'include'; break
      case 'leaverSide':     pickedLeavers.value = new Set(); break
      case 'modifiers':      pickedModifiers.value = new Set(); break
      case 'ranks':          pickedRanks.value = new Set(); break
      case 'sinceAnchor':    sinceAnchorActive.value = false; break
      case 'minPlay':        minPlayMinutes.value = 0; minPlayPercent.value = 0; break
      case 'includeUnknown': includeUnknown.value = true; break
    }
  }

  const clauseExclusionCounts = computed<ClauseSuggestion[]>(() => {
    if (narrowedRecords.value.length > 0) return []
    const clauses = activeClauses()
    if (clauses.length === 0) return []
    const base = records.value.filter((r) => !r.hidden)
    const suggestions: ClauseSuggestion[] = clauses.map((c) => ({
      clauseId: c,
      label: clauseLabel(c),
      wouldSurface: base.filter((r) => matchesNarrowExcept(r, c)).length,
      clear: () => clearClause(c),
    }))
    return suggestions
      .filter((s) => s.wouldSurface > 0)
      .sort((a, b) => b.wouldSurface - a.wouldSurface)
  })

  return {
    // State
    searchText,
    pickedMaps, pickedGameModes, pickedHeroes, pickedRoles, pickedResults, pickedTags, pickedMembers, pickedReviewedBy,
    pickedQueues, pickedPlayModes, pickedSources,
    pickedLeavers, pickedModifiers, pickedRanks,
    pickedRange, customFrom, customTo,
    leaverHandling, minPlayMinutes, minPlayPercent, includeUnknown,
    anchorKey, sinceAnchorActive,
    // Actions
    pickMap, pickGameMode, pickHero, pickRole, pickResult, pickTag, pickMember, pickReviewedBy, pickQueue, pickPlayMode, pickSource, pickRange,
    pickLeaver, pickModifier, pickRank,
    resetNarrow,
    // Derived
    activeClauseCount, anyNarrow,
    searchClauses,
    availableMaps, availableGameModes, availableHeroes, availableRoles, availableResults, availableTags, availableMembers,
    availableLeaverSides, availableModifiers, availableRanks,
    narrowedRecords,
    narrowedExceptMapsRoles,
    narrowedExceptHeroesGameModes,
    clauseExclusionCounts,
  }
}

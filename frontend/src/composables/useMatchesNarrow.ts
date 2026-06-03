import { computed, ref, type Ref } from 'vue'
import type { MatchRecord } from '../api'
import type { LeaverHandling } from './useMatchesDossier'

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

export type PresetRange = 'all' | '7d' | '30d' | '90d' | 'custom'

// Three "reviewed-by" buckets the narrow panel exposes as a
// multi-select. Empty set ≡ no filter, every record passes.
//   - 'self'        → `reviewed_by === 'self'`
//   - 'coach'       → `reviewed_by === 'coach'`
//   - 'unreviewed'  → no review row exists (reviewed_by absent)
export type ReviewedByPick = 'self' | 'coach' | 'unreviewed'

// Parent-owned state bundle. App.vue creates it once via
// `createMatchesNarrowState()` and passes the same object to both
// `useMatchesNarrow` (which derives narrowedRecords) and to
// MatchesView (via the `narrow` prop). Sharing the refs is what
// lets `selection` (in App.vue) track the same filtered set the
// view shows — fixing the prev/next + auto-close-on-hide contract
// that broke when each consumer owned its own copy.
export interface MatchesNarrowState {
  searchText:        Ref<string>
  pickedMaps:        Ref<Set<string>>
  pickedMapTypes:    Ref<Set<string>>
  pickedHeroes:      Ref<Set<string>>
  pickedRoles:       Ref<Set<string>>
  pickedResults:     Ref<Set<string>>
  pickedTags:        Ref<Set<string>>
  pickedReviewedBy:  Ref<Set<ReviewedByPick>>
  pickedRange:       Ref<PresetRange>
  customFrom:        Ref<string>
  customTo:          Ref<string>
  leaverHandling:    Ref<LeaverHandling>
  minPlayMinutes:    Ref<number>
  minPlayPercent:    Ref<number>
  includeUnknown:    Ref<boolean>
  // "Since this match" anchor. `anchorKey` is the match_key of the
  // anchor (empty string ≡ none). The ref is OWNED by
  // `useMatchAnchor` and threaded in here so the narrow filter can
  // read it without having to import the persistence layer — same
  // pattern that lets tests supply a plain `ref('')` instead of a
  // localStorage round-trip. `sinceAnchorActive` is the panel-local
  // "apply the anchor filter?" toggle, session-scoped and reset by
  // resetNarrow.
  anchorKey:         Ref<string>
  sinceAnchorActive: Ref<boolean>
}

export interface CreateMatchesNarrowStateOptions {
  anchorKey?: Ref<string>
}

export function createMatchesNarrowState(opts: CreateMatchesNarrowStateOptions = {}): MatchesNarrowState {
  return {
    searchText:       ref(''),
    pickedMaps:       ref(new Set<string>()),
    pickedMapTypes:   ref(new Set<string>()),
    pickedHeroes:     ref(new Set<string>()),
    pickedRoles:      ref(new Set<string>()),
    pickedResults:    ref(new Set<string>()),
    pickedTags:       ref(new Set<string>()),
    pickedReviewedBy: ref(new Set<ReviewedByPick>()),
    pickedRange:      ref<PresetRange>('all'),
    customFrom:       ref(''),
    customTo:         ref(''),
    leaverHandling:   ref<LeaverHandling>('include'),
    minPlayMinutes:   ref(0),
    minPlayPercent:   ref(0),
    includeUnknown:   ref(false),
    anchorKey:        opts.anchorKey ?? ref(''),
    sinceAnchorActive: ref(false),
  }
}

function toggleSet(set: Set<string>, value: string): Set<string> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function toggleTypedSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)].filter((v) => v != null && v !== '') as T[]
}

// "M:SS" or "H:MM:SS" → minutes as a float. Defensive — bad input
// (non-numeric segments, empty string) reads as 0, which keeps the
// min-play threshold from accidentally including a record whose
// play_time can't be parsed.
function parsePlayTimeMinutes(s: string): number {
  if (!s) return 0
  const parts = s.split(':').map((x) => parseInt(x, 10))
  if (parts.some((n) => isNaN(n))) return 0
  if (parts.length === 2) return parts[0]! + parts[1]! / 60
  if (parts.length === 3) return parts[0]! * 60 + parts[1]! + parts[2]! / 60
  return parts[0] ?? 0
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
    searchText, pickedMaps, pickedMapTypes, pickedHeroes,
    pickedRoles, pickedResults, pickedTags, pickedReviewedBy,
    pickedRange, customFrom, customTo,
    leaverHandling, minPlayMinutes, minPlayPercent, includeUnknown,
    anchorKey, sinceAnchorActive,
  } = state

  // ── Pickers ─────────────────────────────────────────────
  const pickMap        = (v: string) => { pickedMaps.value     = toggleSet(pickedMaps.value,     v) }
  const pickMapType    = (v: string) => { pickedMapTypes.value = toggleSet(pickedMapTypes.value, v) }
  const pickHero       = (v: string) => { pickedHeroes.value   = toggleSet(pickedHeroes.value,   v) }
  const pickRole       = (v: string) => { pickedRoles.value    = toggleSet(pickedRoles.value,    v) }
  const pickResult     = (v: string) => { pickedResults.value  = toggleSet(pickedResults.value,  v) }
  const pickTag        = (v: string) => { pickedTags.value     = toggleSet(pickedTags.value,     v) }
  const pickReviewedBy = (v: ReviewedByPick) => {
    pickedReviewedBy.value = toggleTypedSet(pickedReviewedBy.value, v)
  }

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
    pickedMapTypes.value      = new Set()
    pickedHeroes.value        = new Set()
    pickedRoles.value         = new Set()
    pickedResults.value       = new Set()
    pickedTags.value          = new Set()
    pickedReviewedBy.value    = new Set()
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
    n += pickedMapTypes.value.size
    n += pickedHeroes.value.size
    n += pickedRoles.value.size
    n += pickedResults.value.size
    n += pickedTags.value.size
    n += pickedReviewedBy.value.size
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
  const availableMapTypes = computed(() => uniq(records.value.map((r) => r.data?.type ?? '')).sort())
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

    const search = searchText.value.trim().toLowerCase()

    return base.filter((r) => {
      const d = r.data
      if (!d) return false

      // Free-text search across every lexical surface (map, mode,
      // hero, role, type, primary hero, all heroes_played names,
      // annotation note, annotation tags).
      if (search) {
        const heroesPlayedNames = (d.heroes_played ?? []).map((h) => h.hero ?? '').filter(Boolean)
        const blob = [
          d.map, d.mode, d.hero, d.role, d.type,
          r.annotation?.note,
          ...heroesPlayedNames,
          ...(r.annotation?.tags ?? []),
        ].filter(Boolean).join(' ').toLowerCase()
        if (!blob.includes(search)) return false
      }

      // Date range — applies only to dated rows. Slice the bound
      // strings to YYYY-MM-DD before comparing: the heatmap cell-
      // click writes `${date}T00:00` / `${date}T23:59` (because the
      // selection band needs sub-day resolution), while preset
      // ranges and the manual datepicker write bare YYYY-MM-DD. A
      // raw lexicographic compare between the two forms drops every
      // record on the active day — the longer "T00:00" string sorts
      // strictly greater than the shorter bare date that matches it.
      const dateKey = d.date ?? ''
      if (dateKey) {
        const fromBound = customFrom.value.slice(0, 10)
        const toBound   = customTo.value.slice(0, 10)
        if (fromBound && dateKey < fromBound) return false
        if (toBound   && dateKey > toBound)   return false
      }

      if (pickedMaps.value.size     && !pickedMaps.value.has(d.map     ?? '')) return false
      if (pickedMapTypes.value.size && !pickedMapTypes.value.has(d.type ?? '')) return false
      if (pickedRoles.value.size    && !pickedRoles.value.has(d.role   ?? '')) return false
      if (pickedResults.value.size  && !pickedResults.value.has(d.result ?? '')) return false

      // Hero filter — broad match against the primary AND every
      // heroes_played entry. With min-play thresholds set, the
      // primary-only match no longer qualifies — the picked hero
      // must satisfy a heroes_played threshold. OR semantics
      // between minutes and percent so a user can express "at least
      // 5 minutes OR 50%" in one query.
      if (pickedHeroes.value.size) {
        const minMin = minPlayMinutes.value
        const minPct = minPlayPercent.value
        const anyThreshold = minMin > 0 || minPct > 0
        const matchedAny = [...pickedHeroes.value].some((wanted) => {
          if (d.hero === wanted && !anyThreshold) return true
          return (d.heroes_played ?? []).some((hp) => {
            if (hp.hero !== wanted) return false
            if (!anyThreshold) return true
            const minutes = parsePlayTimeMinutes(hp.play_time ?? '')
            const pct = hp.percent_played ?? 0
            return (minMin > 0 && minutes >= minMin) || (minPct > 0 && pct >= minPct)
          })
        })
        if (!matchedAny) return false
      }

      if (pickedTags.value.size) {
        const tags = new Set(r.annotation?.tags ?? [])
        const hit = [...pickedTags.value].some((t) => tags.has(t))
        if (!hit) return false
      }

      // Reviewed-by — empty picked set means "no filter." Otherwise
      // the record's bucket must be in the set. The 'unreviewed'
      // bucket maps to "no reviewed_by field," which is the natural
      // default for an unreviewed match.
      if (pickedReviewedBy.value.size) {
        const bucket: ReviewedByPick = r.reviewed_by ?? 'unreviewed'
        if (!pickedReviewedBy.value.has(bucket)) return false
      }

      // Since-anchor — drop records on or before the anchor's
      // parsed_at. Strict-greater so the anchor itself doesn't show
      // (it's the user's "what's happened SINCE" reference point).
      if (anchorFloor !== null) {
        const parsedAt = r.parsed_at ?? ''
        if (parsedAt <= anchorFloor) return false
      }

      if (leaverHandling.value === 'hide' && r.annotation?.leaver) return false

      return true
    })
  })

  return {
    // State
    searchText,
    pickedMaps, pickedMapTypes, pickedHeroes, pickedRoles, pickedResults, pickedTags, pickedReviewedBy,
    pickedRange, customFrom, customTo,
    leaverHandling, minPlayMinutes, minPlayPercent, includeUnknown,
    anchorKey, sinceAnchorActive,
    // Actions
    pickMap, pickMapType, pickHero, pickRole, pickResult, pickTag, pickReviewedBy, pickRange,
    resetNarrow,
    // Derived
    activeClauseCount, anyNarrow,
    availableMaps, availableMapTypes, availableHeroes, availableRoles, availableResults, availableTags,
    narrowedRecords,
  }
}

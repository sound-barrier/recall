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

export interface MatchesNarrowOptions {
  records: Readonly<Ref<MatchRecord[]>>
}

function toggleSet(set: Set<string>, value: string): Set<string> {
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

export function useMatchesNarrow(opts: MatchesNarrowOptions) {
  const { records } = opts

  // ── Filter state ────────────────────────────────────────
  const searchText      = ref('')
  const pickedMaps      = ref(new Set<string>())
  const pickedMapTypes  = ref(new Set<string>())
  const pickedHeroes    = ref(new Set<string>())
  const pickedRoles     = ref(new Set<string>())
  const pickedResults   = ref(new Set<string>())
  const pickedTags      = ref(new Set<string>())
  const pickedRange     = ref<PresetRange>('all')
  const customFrom      = ref('')
  const customTo        = ref('')
  const leaverHandling  = ref<LeaverHandling>('include')
  const minPlayMinutes  = ref(0)
  const minPlayPercent  = ref(0)
  const includeUnknown  = ref(false)

  // ── Pickers ─────────────────────────────────────────────
  const pickMap     = (v: string) => { pickedMaps.value     = toggleSet(pickedMaps.value,     v) }
  const pickMapType = (v: string) => { pickedMapTypes.value = toggleSet(pickedMapTypes.value, v) }
  const pickHero    = (v: string) => { pickedHeroes.value   = toggleSet(pickedHeroes.value,   v) }
  const pickRole    = (v: string) => { pickedRoles.value    = toggleSet(pickedRoles.value,    v) }
  const pickResult  = (v: string) => { pickedResults.value  = toggleSet(pickedResults.value,  v) }
  const pickTag     = (v: string) => { pickedTags.value     = toggleSet(pickedTags.value,     v) }

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
    searchText.value      = ''
    pickedMaps.value      = new Set()
    pickedMapTypes.value  = new Set()
    pickedHeroes.value    = new Set()
    pickedRoles.value     = new Set()
    pickedResults.value   = new Set()
    pickedTags.value      = new Set()
    pickedRange.value     = 'all'
    customFrom.value      = ''
    customTo.value        = ''
    leaverHandling.value  = 'include'
    minPlayMinutes.value  = 0
    minPlayPercent.value  = 0
    includeUnknown.value  = false
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
    if (leaverHandling.value !== 'include') n++
    if (minPlayMinutes.value > 0) n++
    if (minPlayPercent.value > 0) n++
    if (includeUnknown.value) n++
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
    const base = includeUnknown.value
      ? records.value
      : records.value.filter((r) => !!r.data?.map)

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

      // Date range — applies only to dated rows.
      const dateKey = d.date ?? ''
      if (dateKey) {
        if (customFrom.value && dateKey < customFrom.value) return false
        if (customTo.value   && dateKey > customTo.value)   return false
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

      if (leaverHandling.value === 'hide' && r.annotation?.leaver) return false

      return true
    })
  })

  return {
    // State
    searchText,
    pickedMaps, pickedMapTypes, pickedHeroes, pickedRoles, pickedResults, pickedTags,
    pickedRange, customFrom, customTo,
    leaverHandling, minPlayMinutes, minPlayPercent, includeUnknown,
    // Actions
    pickMap, pickMapType, pickHero, pickRole, pickResult, pickTag, pickRange,
    resetNarrow,
    // Derived
    activeClauseCount, anyNarrow,
    availableMaps, availableMapTypes, availableHeroes, availableRoles, availableResults, availableTags,
    narrowedRecords,
  }
}

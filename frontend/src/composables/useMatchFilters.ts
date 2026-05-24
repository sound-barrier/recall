import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import type { MatchRecord } from '../api'
import { SCREENSHOT_TYPES, matchTime, detectScreenshotSlots } from '../match-helpers'

// Fields whose values come directly from a scalar property on MatchRecord.data.
type StringMatchField = 'mode' | 'type' | 'role' | 'map' | 'result' | 'hero'

export function useMatchFilters(
  records: Readonly<Ref<MatchRecord[]>>,
  // Optional: when this ref is false (default), records without a
  // parseable data.date are dropped from the matched view. Toggling
  // it on surfaces them in the UNKNOWN DATE bucket. Drives the
  // FilterRail's "Undated" toggle button + the localStorage-backed
  // preference exposed by useIncludeUndated.
  includeUndated?: Readonly<Ref<boolean>>,
) {
  // ── Filter state ─────────────────────────────────────────────────────
  // Each field is an array: empty = no filter; multiple entries = union (OR).
  const filterMode   = ref<string[]>([])
  const filterType   = ref<string[]>([])
  const filterRole   = ref<string[]>([])
  const filterMap    = ref<string[]>([])
  const filterHero   = ref<string[]>([])
  const filterResult = ref<string[]>([])
  const filterSshot  = ref<string[]>([])
  const filterFrom   = ref('')
  const filterTo     = ref('')
  const sortDir      = ref('desc')

  // Field name → ref lookup so a single toggleFilter() drives every field.
  const filterRefs: Record<string, Ref<string[]>> = {
    mode:   filterMode,
    type:   filterType,
    role:   filterRole,
    map:    filterMap,
    hero:   filterHero,
    result: filterResult,
    sshot:  filterSshot,
  }

  function filterList(field: string): string[] {
    return filterRefs[field]?.value ?? []
  }

  // ── Filter option rosters ─────────────────────────────────────────────
  function uniqueValues(field: StringMatchField): string[] {
    const set = new Set<string>()
    for (const r of records.value) {
      const v = r.data?.[field]
      if (v) set.add(v)
    }
    return [...set].sort()
  }

  const modes    = computed(() => uniqueValues('mode'))
  const types    = computed(() => uniqueValues('type'))
  const roles    = computed(() => uniqueValues('role'))
  const maps     = computed(() => uniqueValues('map'))
  const results  = computed(() => uniqueValues('result'))
  const sshotTypes = computed(() => SCREENSHOT_TYPES)

  // Heroes need a custom collector: uniqueValues('hero') only returns the
  // primary hero. Secondaries live in heroes_played[]; union both so every
  // hero the user has played appears in the dropdown.
  const heroes = computed(() => {
    const set = new Set<string>()
    for (const r of records.value) {
      if (r.data?.hero) set.add(r.data.hero)
      for (const hp of (r.data?.heroes_played ?? [])) {
        if (hp.hero) set.add(hp.hero)
      }
    }
    return [...set].sort()
  })

  // ── Core filter logic ─────────────────────────────────────────────────
  const filtered = computed(() =>
    records.value.filter(r => {
      const d = r.data ?? {}
      if (!d.map) return false

      // Undated records (no parseable date+finished_at) are hidden by
      // default. Toggling the FilterRail's "Undated" button — which
      // flips this ref — opts them back in. Independent of the
      // date-range filter below, which excludes undated rows
      // regardless when a range is set.
      const undated = !d.date || !d.finished_at
      if (undated && !(includeUndated?.value ?? false)) return false
      if (filterMode.value.length   && !filterMode.value.includes(d.mode     ?? '')) return false
      if (filterType.value.length   && !filterType.value.includes(d.type     ?? '')) return false
      if (filterRole.value.length   && !filterRole.value.includes(d.role     ?? '')) return false
      if (filterMap.value.length    && !filterMap.value.includes(d.map       ?? '')) return false
      if (filterResult.value.length && !filterResult.value.includes(d.result ?? '')) return false

      // Screenshot-type filter: union ("any of the picked types is present"
      // among this match's parsed source files). Falls back to slot-detection
      // inference for rows parsed before per-file type tracking landed.
      if (filterSshot.value.length) {
        const picks  = filterSshot.value
        const stored: string[] = r.source_types ? Object.values(r.source_types) : []
        const inferred = stored.length === 0
          ? detectScreenshotSlots(r).filter(s => s.present).map(s => s.key)
          : []
        const present = stored.length ? stored : inferred
        if (!picks.some(p => present.includes(p))) return false
      }

      // Hero filter matches the primary hero OR any entry in heroes_played,
      // so a secondary hero like Juno (47 % on Rialto) still surfaces the
      // match. With multi-select, ANY chosen hero must appear — union.
      if (filterHero.value.length) {
        const picks       = filterHero.value
        const inPrimary   = picks.includes(d.hero ?? '')
        const inSecondary = (d.heroes_played ?? []).some(hp => picks.includes(hp.hero))
        if (!inPrimary && !inSecondary) return false
      }

      // Date/time range. Requires an explicit date+finished_at on the row —
      // the match_key timestamp fallback is too approximate for range queries,
      // and undated rows are silently excluded to match the card UI.
      if (filterFrom.value || filterTo.value) {
        if (!d.date || !d.finished_at) return false
        const t = `${d.date}T${d.finished_at}`
        if (filterFrom.value && t < filterFrom.value) return false
        if (filterTo.value   && t > filterTo.value)   return false
      }

      return true
    })
  )

  const filteredSorted = computed(() => {
    const list = [...filtered.value]
    const dir  = sortDir.value === 'asc' ? 1 : -1
    list.sort((a, b) => {
      const ta = matchTime(a), tb = matchTime(b)
      if (ta < tb) return -1 * dir
      if (ta > tb) return  1 * dir
      return 0
    })
    return list
  })

  // ── Derived counts ────────────────────────────────────────────────────
  const anyFilter = computed(() =>
    !!(filterMode.value.length || filterType.value.length || filterRole.value.length ||
       filterMap.value.length  || filterHero.value.length || filterResult.value.length ||
       filterSshot.value.length || filterFrom.value || filterTo.value)
  )

  const activeFilterCount = computed(() => {
    let n = 0
    if (filterMode.value.length)   n++
    if (filterType.value.length)   n++
    if (filterRole.value.length)   n++
    if (filterMap.value.length)    n++
    if (filterHero.value.length)   n++
    if (filterResult.value.length) n++
    if (filterSshot.value.length)  n++
    if (filterFrom.value)          n++
    if (filterTo.value)            n++
    return n
  })

  // Rows without an explicit date+finished_at are excluded by any active
  // date-range filter. Surfaced as a hint near the date inputs.
  const undatedMatchCount = computed(() =>
    records.value.filter(r => !(r.data?.date && r.data?.finished_at)).length
  )

  // ── Mutations ─────────────────────────────────────────────────────────
  function toggleSort() {
    sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  }

  // Toggle `value` in/out of the field's array. Drives both badge clicks
  // and popover checkboxes with a single handler.
  function toggleFilter(field: string, value: string) {
    if (!value) return
    const r = filterRefs[field]
    if (!r) return
    const i = r.value.indexOf(value)
    r.value = i >= 0 ? r.value.filter((_, j) => j !== i) : [...r.value, value]
  }

  function isActive(field: string, value: string): boolean {
    return !!(filterRefs[field]?.value.includes(value))
  }

  function selectAllFilter(field: string, options: string[]) {
    const r = filterRefs[field]
    if (r) r.value = [...options]
  }

  function clearFilterField(field: string) {
    const r = filterRefs[field]
    if (r) r.value = []
  }

  // Resets all filter arrays and date range. Does NOT close any open filter
  // popover — callers should also call closeFilterPanel() when needed.
  function clearFilters() {
    filterMode.value   = []
    filterType.value   = []
    filterRole.value   = []
    filterMap.value    = []
    filterHero.value   = []
    filterResult.value = []
    filterSshot.value  = []
    filterFrom.value   = ''
    filterTo.value     = ''
  }

  function resetDateRange() {
    filterFrom.value = ''
    filterTo.value   = ''
  }

  return {
    filterMode, filterType, filterRole, filterMap, filterHero, filterResult, filterSshot,
    filterFrom, filterTo, sortDir,
    filterRefs, filterList,
    modes, types, roles, maps, results, sshotTypes, heroes,
    filtered, filteredSorted,
    anyFilter, activeFilterCount, undatedMatchCount,
    toggleFilter, isActive, selectAllFilter, clearFilterField, clearFilters, resetDateRange, toggleSort,
  }
}

import { ref, onMounted, type Ref } from 'vue'

// Persisted filter combos — users settle into 3-4 recurring views
// ("placements", "support games only", "last week's stack") and
// rebuild them by hand every visit. useFilterPresets stores named
// snapshots of every FilterRail control in localStorage so a single
// click restores the lot.
//
// Storage shape is a JSON array of `{name, snapshot, savedAt}` under
// the key `recall.filterPresets`. Adding a new filter ref to
// useMatchFilters means also adding its key to FilterPresetSnapshot
// and to the apply path in App.vue — older presets silently fall
// back to defaults for the missing dimension when applied.

type LeaverHandlingMode = 'include' | 'exclude-tally' | 'hide'

export interface FilterPresetSnapshot {
  filters: {
    mode: string[]
    type: string[]
    role: string[]
    map: string[]
    hero: string[]
    result: string[]
    sshot: string[]
    tags: string[]
  }
  matchQuery: string
  filterFrom: string
  filterTo: string
  sortDir: string
  minPlayPercent: number
  minPlayMinutes: number
  includeUndated: boolean
  leaverHandling: LeaverHandlingMode
  showHidden: boolean
}

export interface FilterPreset {
  name: string
  snapshot: FilterPresetSnapshot
  savedAt: number
}

export const FILTER_PRESETS_STORAGE_KEY = 'recall.filterPresets'

const LEAVER_MODES = new Set<string>(['include', 'exclude-tally', 'hide'])

function strArr(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

// Defensive shape coercion — accepts a JSON-parsed object of unknown
// origin (possibly hand-edited, possibly from a previous schema) and
// returns a fully-populated snapshot.
export function parsePresetSnapshot(raw: unknown): FilterPresetSnapshot {
  const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  const f = (obj.filters && typeof obj.filters === 'object') ? obj.filters as Record<string, unknown> : {}
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0
  const str = (v: unknown) => typeof v === 'string' ? v : ''
  return {
    filters: {
      mode:   strArr(f.mode),
      type:   strArr(f.type),
      role:   strArr(f.role),
      map:    strArr(f.map),
      hero:   strArr(f.hero),
      result: strArr(f.result),
      sshot:  strArr(f.sshot),
      tags:   strArr(f.tags),
    },
    // Accept either the new `matchQuery` key (post-rename) or the
    // legacy `noteSearch` key (presets saved before the global search
    // shipped) so older localStorage payloads keep loading.
    matchQuery:     str(obj.matchQuery ?? obj.noteSearch),
    filterFrom:     str(obj.filterFrom),
    filterTo:       str(obj.filterTo),
    sortDir:        obj.sortDir === 'asc' ? 'asc' : 'desc',
    minPlayPercent: num(obj.minPlayPercent),
    minPlayMinutes: num(obj.minPlayMinutes),
    includeUndated: obj.includeUndated === true,
    leaverHandling: (typeof obj.leaverHandling === 'string' && LEAVER_MODES.has(obj.leaverHandling))
      ? obj.leaverHandling as LeaverHandlingMode
      : 'include',
    showHidden:     obj.showHidden === true,
  }
}

export function readStoredPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(FILTER_PRESETS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: FilterPreset[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      const name = typeof e.name === 'string' ? e.name.trim() : ''
      if (!name) continue
      const savedAt = typeof e.savedAt === 'number' && Number.isFinite(e.savedAt) ? e.savedAt : Date.now()
      out.push({ name, snapshot: parsePresetSnapshot(e.snapshot), savedAt })
    }
    return out
  } catch (_) {
    return []
  }
}

export interface UseFilterPresets {
  presets: Ref<FilterPreset[]>
  savePreset: (name: string, snapshot: FilterPresetSnapshot) => void
  deletePreset: (name: string) => void
  getPreset: (name: string) => FilterPreset | undefined
  hasPreset: (name: string) => boolean
}

export function useFilterPresets(): UseFilterPresets {
  const presets = ref<FilterPreset[]>([]) as Ref<FilterPreset[]>

  function persist() {
    try {
      localStorage.setItem(FILTER_PRESETS_STORAGE_KEY, JSON.stringify(presets.value))
    } catch (_) {
      // QuotaExceeded / SecurityError — keep the in-memory ref so the
      // session still works, mirror the swallow-on-write of usePersistedRef.
    }
  }

  function savePreset(rawName: string, snapshot: FilterPresetSnapshot) {
    const name = rawName.trim()
    if (!name) return
    const entry: FilterPreset = { name, snapshot, savedAt: Date.now() }
    const idx = presets.value.findIndex(p => p.name === name)
    presets.value = idx >= 0
      ? presets.value.map((p, i) => i === idx ? entry : p)
      : [...presets.value, entry]
    persist()
  }

  function deletePreset(name: string) {
    const before = presets.value.length
    presets.value = presets.value.filter(p => p.name !== name)
    if (presets.value.length !== before) persist()
  }

  onMounted(() => {
    presets.value = readStoredPresets()
  })

  return {
    presets,
    savePreset,
    deletePreset,
    getPreset: (name) => presets.value.find(p => p.name === name),
    hasPreset: (name) => presets.value.some(p => p.name === name),
  }
}

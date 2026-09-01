import { ref, computed, watchEffect, type ComputedRef, type Ref } from 'vue'
import type { OWData } from '@/api-client'
import { useOWDataQuery } from '@/queries/system'

// Season is one competitive-season window (from reference data). Start/end are
// UTC RFC3339 strings; season assignment compares a match's canonical UTC
// instant against [start, end).
export type Season = NonNullable<OWData['seasons']>[number]
export type Patch = NonNullable<OWData['patches']>[number]

// SeasonWindow is the parsed comparable form of a season boundary — epoch ms,
// half-open [startMs, endMs). null from the resolver = unknown season name.
export type SeasonWindow = { startMs: number; endMs: number }

// useOWData exposes the static Overwatch reference data
// (heroes-by-role + maps-by-game-mode) fetched once per session from
// /api/owdata and surfaced as canonical-name lookups for the UI.
// Module-level singleton — the first call kicks off the fetch and
// every subsequent call (from any component, any depth) shares the
// same reactive refs, so no prop-drilling is needed.
//
// The data is genuinely static (compiled into the parser binary at
// build time from pkg/parser/{heroes,maps}.yaml), so a one-shot
// fetch per session is correct. Failure leaves the lookups empty
// and consumers fall back to displaying the stored lowercase form
// — a non-critical degradation, no user-facing error.
//
// Display helpers normalize their input the same way the Go parser
// does — lowercase + strip diacritics + strip colons + collapse
// whitespace — so `heroDisplayName("Soldier: 76")`,
// `heroDisplayName("soldier 76")`, and the lowercase stored form
// `heroDisplayName("soldier 76")` all return the canonical
// "Soldier: 76" string.

export type OWDataApi = {
  data: Ref<OWData | null>
  heroDisplayName: (input: string | null | undefined) => string
  mapDisplayName: (input: string | null | undefined) => string
  heroRole:        (input: string | null | undefined) => string
  mapGameMode:         (input: string | null | undefined) => string
  heroIndex:       ComputedRef<Map<string, { display: string; role: string }>>
  mapIndex:        ComputedRef<Map<string, { display: string; gameMode: string }>>
  seasons:         ComputedRef<Season[]>
  /** Moments the game changed, oldest first. */
  patches:         ComputedRef<Patch[]>
  seasonsByChapter: ComputedRef<{ chapter: string; seasons: Season[] }[]>
  seasonWindow:    (name: string) => SeasonWindow | null
}

// Module-level ref shared by every lookup helper below; each useOWData()
// call syncs it from the shared query cache entry.
const data = ref<OWData | null>(null)

function normalize(s: string): string {
  // Mirrors pkg/parser/owdata.go normalize(): lowercase, strip
  // combining diacritics, strip colons, collapse whitespace.
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/:/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const heroIndex = computed(() => {
  const m = new Map<string, { display: string; role: string }>()
  if (!data.value) return m
  for (const [role, names] of Object.entries(data.value.heroes_by_role)) {
    for (const display of names) {
      m.set(normalize(display), { display, role })
    }
  }
  return m
})

const mapIndex = computed(() => {
  const m = new Map<string, { display: string; gameMode: string }>()
  if (!data.value) return m
  for (const [gameMode, names] of Object.entries(data.value.maps_by_game_mode)) {
    for (const display of names) {
      m.set(normalize(display), { display, gameMode })
    }
  }
  return m
})

const seasons = computed<Season[]>(() => data.value?.seasons ?? [])
const patches = computed<Patch[]>(() => data.value?.patches ?? [])

// Chapters in first-appearance order, each with its seasons in file order —
// drives the grouped <optgroup> in the season selector.
const seasonsByChapter = computed(() => {
  const order: string[] = []
  const byChapter = new Map<string, Season[]>()
  for (const s of seasons.value) {
    const chapter = s.chapter || 'Seasons'
    if (!byChapter.has(chapter)) {
      byChapter.set(chapter, [])
      order.push(chapter)
    }
    byChapter.get(chapter)!.push(s)
  }
  return order.map((chapter) => ({ chapter, seasons: byChapter.get(chapter)! }))
})

// seasonWindow resolves a season NAME to its parsed [startMs, endMs) window.
// The narrow state stores only the name (preset-serializable); the window is
// re-resolved from live reference data at filter time (the anchorKey pattern).
const seasonWindowIndex = computed(() => {
  const m = new Map<string, SeasonWindow>()
  for (const s of seasons.value) {
    const startMs = Date.parse(s.start)
    const endMs = Date.parse(s.end)
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
      m.set(s.name, { startMs, endMs })
    }
  }
  return m
})

function seasonWindow(name: string): SeasonWindow | null {
  return seasonWindowIndex.value.get(name) ?? null
}

function heroDisplayName(input: string | null | undefined): string {
  if (!input) return ''
  return heroIndex.value.get(normalize(input))?.display ?? input
}

function mapDisplayName(input: string | null | undefined): string {
  if (!input) return ''
  return mapIndex.value.get(normalize(input))?.display ?? input
}

function heroRole(input: string | null | undefined): string {
  if (!input) return ''
  return heroIndex.value.get(normalize(input))?.role ?? ''
}

function mapGameMode(input: string | null | undefined): string {
  if (!input) return ''
  return mapIndex.value.get(normalize(input))?.gameMode ?? ''
}

export function useOWData(): OWDataApi {
  // Each caller registers its own observer on the shared cache entry (one
  // GET per session; staleTime Infinity). The module-level `data` ref stays
  // the reactive source for the lookup helpers; the sync is idempotent
  // across instances. A fetch failure leaves the lookups empty and the UI
  // falls back to the stored lowercase form.
  const query = useOWDataQuery()
  watchEffect(() => { data.value = query.data.value ?? null })
  return { data, heroDisplayName, mapDisplayName, heroRole, mapGameMode, heroIndex, mapIndex, seasons, patches, seasonsByChapter, seasonWindow }
}

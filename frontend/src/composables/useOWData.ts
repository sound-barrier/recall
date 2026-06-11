import { ref, computed, type ComputedRef, type Ref } from 'vue'
import { GetOWData, type OWData } from '../api'

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
}

// Module-level singleton state. Set on first call, reused thereafter.
const data = ref<OWData | null>(null)
let fetchStarted = false

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
  if (!fetchStarted) {
    fetchStarted = true
    GetOWData()
      .then(d => { data.value = d })
      .catch(() => { /* leave lookups empty; UI falls back to lowercase */ })
  }
  return { data, heroDisplayName, mapDisplayName, heroRole, mapGameMode, heroIndex, mapIndex }
}

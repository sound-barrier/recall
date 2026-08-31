import { ref, onMounted } from 'vue'
import type { MatchesNarrowState, ReviewedByPick, QueuePick, PlayModePick, SourcePick, LeaverPick, ThrowerPick, PresetRange } from '@/composables/matches/narrow/matchesNarrow.types'
import type { ExclusionHandling, LeaverHandling } from '@/composables/matches/dossier/useMatchesDossier'

// Saved-set / preset feature.
//
// Stores named snapshots of MatchesNarrowState in localStorage so a
// user with a recurring "comp clutch" set doesn't have to re-pick
// hero / role / tag every session. Snapshot shape is JSON-safe (Sets
// stringified as arrays + sorted for stable serialization).
//
// Storage key: `recall.narrowPresets.v2`. The `.v2` suffix is
// intentional — PR #100 deleted the prior `useFilterPresets` and
// any users with a v1 key get a clean slate, no migration.

const STORAGE_KEY = 'recall.narrowPresets.v2'

interface SerializedNarrow {
  searchText:        string
  pickedMaps:        string[]
  pickedGameModes:    string[]
  pickedHeroes:      string[]
  pickedRoles:       string[]
  pickedResults:     string[]
  pickedTags:        string[]
  pickedMembers:     string[]
  pickedReviewedBy:  ReviewedByPick[]
  pickedQueues:      QueuePick[]
  pickedPlayModes:   PlayModePick[]
  pickedSources:     SourcePick[]
  pickedLeavers:     LeaverPick[]
  pickedThrowers:    ThrowerPick[]
  pickedModifiers:   string[]
  pickedRanks:       string[]
  pickedRange:       PresetRange
  customFrom:        string
  customTo:          string
  customFromTime:    string
  customToTime:      string
  pickedSeason:      string
  leaverHandling:    LeaverHandling
  exclusionHandling: ExclusionHandling
  minPlayMinutes:    number
  minPlayPercent:    number
  includeUnknown:    boolean
  sinceAnchorActive: boolean
}

export interface NarrowPreset {
  name:  string
  state: SerializedNarrow
}

function serialize(state: MatchesNarrowState): SerializedNarrow {
  return {
    searchText:        state.searchText.value,
    pickedMaps:        [...state.pickedMaps.value].sort(),
    pickedGameModes:    [...state.pickedGameModes.value].sort(),
    pickedHeroes:      [...state.pickedHeroes.value].sort(),
    pickedRoles:       [...state.pickedRoles.value].sort(),
    pickedResults:     [...state.pickedResults.value].sort(),
    pickedTags:        [...state.pickedTags.value].sort(),
    pickedMembers:     [...state.pickedMembers.value].sort(),
    pickedReviewedBy:  [...state.pickedReviewedBy.value],
    pickedQueues:      [...state.pickedQueues.value],
    pickedPlayModes:   [...state.pickedPlayModes.value],
    pickedSources:     [...state.pickedSources.value],
    pickedLeavers:     [...state.pickedLeavers.value],
    pickedThrowers:    [...state.pickedThrowers.value],
    pickedModifiers:   [...state.pickedModifiers.value].sort(),
    pickedRanks:       [...state.pickedRanks.value].sort(),
    pickedRange:       state.pickedRange.value,
    customFrom:        state.customFrom.value,
    customTo:          state.customTo.value,
    customFromTime:    state.customFromTime.value,
    customToTime:      state.customToTime.value,
    pickedSeason:      state.pickedSeason.value,
    leaverHandling:    state.leaverHandling.value,
    exclusionHandling: state.exclusionHandling.value,
    minPlayMinutes:    state.minPlayMinutes.value,
    minPlayPercent:    state.minPlayPercent.value,
    includeUnknown:    state.includeUnknown.value,
    sinceAnchorActive: state.sinceAnchorActive.value,
  }
}

// A preset saved before a dimension existed carries nothing for it. Both
// helpers RESET that dimension to its empty value rather than leaving the
// live pick in place: applying a preset must land the set the user saved,
// never a merge of it with whatever happened to be on screen.
//
// They also keep `apply` a flat list of assignments. Spelled inline, the
// fallbacks read as eleven separate decisions and the function fails the
// complexity gate — one idea, stated once, is both cheaper and truer.
function savedSet<T>(saved: T[] | undefined): Set<T> {
  return new Set(saved ?? [])
}

function savedOr<T>(saved: T | undefined, empty: T): T {
  return saved ?? empty
}

function apply(state: MatchesNarrowState, s: SerializedNarrow): void {
  state.searchText.value        = s.searchText
  state.pickedMaps.value        = savedSet(s.pickedMaps)
  state.pickedGameModes.value   = savedSet(s.pickedGameModes)
  state.pickedHeroes.value      = savedSet(s.pickedHeroes)
  state.pickedRoles.value       = savedSet(s.pickedRoles)
  state.pickedResults.value     = savedSet(s.pickedResults)
  state.pickedTags.value        = savedSet(s.pickedTags)
  state.pickedMembers.value     = savedSet(s.pickedMembers)
  state.pickedReviewedBy.value  = savedSet(s.pickedReviewedBy)
  state.pickedQueues.value      = savedSet(s.pickedQueues)
  state.pickedPlayModes.value   = savedSet(s.pickedPlayModes)
  state.pickedSources.value     = savedSet(s.pickedSources)
  state.pickedLeavers.value     = savedSet(s.pickedLeavers)
  state.pickedThrowers.value    = savedSet(s.pickedThrowers)
  state.pickedModifiers.value   = savedSet(s.pickedModifiers)
  state.pickedRanks.value       = savedSet(s.pickedRanks)
  state.pickedRange.value       = s.pickedRange
  state.customFrom.value        = s.customFrom
  state.customTo.value          = s.customTo
  state.customFromTime.value    = savedOr(s.customFromTime, '')
  state.customToTime.value      = savedOr(s.customToTime, '')
  state.pickedSeason.value      = savedOr(s.pickedSeason, '')
  state.leaverHandling.value    = s.leaverHandling
  state.exclusionHandling.value = savedOr(s.exclusionHandling, 'exclude-tally')
  state.minPlayMinutes.value    = s.minPlayMinutes
  state.minPlayPercent.value    = s.minPlayPercent
  state.includeUnknown.value    = s.includeUnknown
  state.sinceAnchorActive.value = s.sinceAnchorActive
}

function readStored(): NarrowPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is NarrowPreset =>
      p && typeof p === 'object' && typeof p.name === 'string' && p.state && typeof p.state === 'object')
  } catch (_) {
    return []
  }
}

function writeStored(presets: NarrowPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch (_) { /* quota / security — best-effort */ }
}

export function useNarrowPresets(state: MatchesNarrowState) {
  const presets = ref<NarrowPreset[]>(readStored())

  onMounted(() => {
    presets.value = readStored()
  })

  function savePreset(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const snapshot = serialize(state)
    // Replace if a preset by that name already exists — the user's
    // intent for "Save as <existing name>" is overwrite, not error.
    const existing = presets.value.findIndex((p) => p.name === trimmed)
    if (existing >= 0) {
      presets.value = [
        ...presets.value.slice(0, existing),
        { name: trimmed, state: snapshot },
        ...presets.value.slice(existing + 1),
      ]
    } else {
      presets.value = [...presets.value, { name: trimmed, state: snapshot }]
    }
    writeStored(presets.value)
  }

  function applyPreset(name: string) {
    const p = presets.value.find((x) => x.name === name)
    if (!p) return
    apply(state, p.state)
  }

  function deletePreset(name: string) {
    presets.value = presets.value.filter((p) => p.name !== name)
    writeStored(presets.value)
  }

  return {
    presets,
    savePreset,
    applyPreset,
    deletePreset,
  }
}

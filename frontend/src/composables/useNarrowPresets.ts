import { ref, onMounted } from 'vue'
import type { MatchesNarrowState, ReviewedByPick, QueuePick, PlayModePick, PresetRange } from './useMatchesNarrow'
import type { LeaverHandling } from './useMatchesDossier'

// Saved-set / preset feature (UI_RECOMMENDATIONS item 8).
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
  pickedMapTypes:    string[]
  pickedHeroes:      string[]
  pickedRoles:       string[]
  pickedResults:     string[]
  pickedTags:        string[]
  pickedReviewedBy:  ReviewedByPick[]
  pickedQueues:      QueuePick[]
  pickedPlayModes:   PlayModePick[]
  pickedRange:       PresetRange
  customFrom:        string
  customTo:          string
  leaverHandling:    LeaverHandling
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
    pickedMapTypes:    [...state.pickedMapTypes.value].sort(),
    pickedHeroes:      [...state.pickedHeroes.value].sort(),
    pickedRoles:       [...state.pickedRoles.value].sort(),
    pickedResults:     [...state.pickedResults.value].sort(),
    pickedTags:        [...state.pickedTags.value].sort(),
    pickedReviewedBy:  [...state.pickedReviewedBy.value],
    pickedQueues:      [...state.pickedQueues.value],
    pickedPlayModes:   [...state.pickedPlayModes.value],
    pickedRange:       state.pickedRange.value,
    customFrom:        state.customFrom.value,
    customTo:          state.customTo.value,
    leaverHandling:    state.leaverHandling.value,
    minPlayMinutes:    state.minPlayMinutes.value,
    minPlayPercent:    state.minPlayPercent.value,
    includeUnknown:    state.includeUnknown.value,
    sinceAnchorActive: state.sinceAnchorActive.value,
  }
}

function apply(state: MatchesNarrowState, s: SerializedNarrow): void {
  state.searchText.value        = s.searchText
  state.pickedMaps.value        = new Set(s.pickedMaps)
  state.pickedMapTypes.value    = new Set(s.pickedMapTypes)
  state.pickedHeroes.value      = new Set(s.pickedHeroes)
  state.pickedRoles.value       = new Set(s.pickedRoles)
  state.pickedResults.value     = new Set(s.pickedResults)
  state.pickedTags.value        = new Set(s.pickedTags)
  state.pickedReviewedBy.value  = new Set(s.pickedReviewedBy)
  state.pickedQueues.value      = new Set(s.pickedQueues)
  state.pickedPlayModes.value   = new Set(s.pickedPlayModes)
  state.pickedRange.value       = s.pickedRange
  state.customFrom.value        = s.customFrom
  state.customTo.value          = s.customTo
  state.leaverHandling.value    = s.leaverHandling
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

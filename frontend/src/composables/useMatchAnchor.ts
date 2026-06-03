import { type Ref } from 'vue'

import { usePersistedRef } from './usePersistedRef'

// "Since this match" anchor — the user marks a single match as a
// reference point (post-review milestone, coaching checkpoint, new
// season start, …) and the Matches narrow panel exposes a "Since
// {anchor}" toggle that filters out everything chronologically
// earlier. Persisted per-browser-profile in localStorage so it
// survives reloads but stays local to the install.
//
// Stored as a string: the match_key of the anchor, or the empty
// string for "no anchor set." Empty-string-as-absence avoids the
// usePersistedRef null-clearing dance — match_key values are never
// empty in practice.

export const ANCHOR_STORAGE_KEY = 'recall.matches.sinceAnchor'

export interface MatchAnchorApi {
  anchorKey: Ref<string>
  setAnchor: (key: string) => void
  clearAnchor: () => void
}

let cached: MatchAnchorApi | null = null

export function useMatchAnchor(): MatchAnchorApi {
  if (cached) return cached
  const { value, set } = usePersistedRef<string>({
    key: ANCHOR_STORAGE_KEY,
    defaultValue: '',
    parse: (raw) => raw,
  })
  cached = {
    anchorKey: value,
    setAnchor: (key: string) => set(key),
    clearAnchor: () => set(''),
  }
  return cached
}

export function _resetMatchAnchorForTest(): void {
  cached = null
}

import { usePersistedRef, parseBoolish, serializeBoolish } from './usePersistedRef'

export const INCLUDE_UNDATED_STORAGE_KEY = 'recall.includeUndated'

// Persisted toggle for the "Include undated matches" control in the
// FilterRail. Default false — records that pass the matched-view filter
// but lack a parseable data.date are hidden until the user opts in.
// Once toggled ON, the preference survives across launches.

export function readStoredIncludeUndated(): boolean {
  try {
    const stored = localStorage.getItem(INCLUDE_UNDATED_STORAGE_KEY)
    return parseBoolish(stored ?? '') ?? false
  } catch (_) {
    return false
  }
}

export function useIncludeUndated() {
  const { value: includeUndated, set: setIncludeUndated } = usePersistedRef<boolean>({
    key: INCLUDE_UNDATED_STORAGE_KEY,
    defaultValue: false,
    parse: parseBoolish,
    serialize: serializeBoolish,
  })
  return { includeUndated, setIncludeUndated }
}

import { usePersistedRef, parseBoolish, serializeBoolish } from './usePersistedRef'

export const INCLUDE_UNKNOWN_STORAGE_KEY = 'recall.includeUnknown'

// Persisted toggle for the "Show unknown-map matches" control on the
// Matches narrow panel. Default false — matches whose data.map is
// empty (parser couldn't classify the screenshot) are routed to the
// Unknown tab and stay out of the Matches dossier + leaves until the
// user opts in. Mirror shape of useIncludeUndated.

export function readStoredIncludeUnknown(): boolean {
  try {
    const stored = localStorage.getItem(INCLUDE_UNKNOWN_STORAGE_KEY)
    return parseBoolish(stored ?? '') ?? false
  } catch (_) {
    return false
  }
}

export function useIncludeUnknown() {
  const { value: includeUnknown, set: setIncludeUnknown } = usePersistedRef<boolean>({
    key: INCLUDE_UNKNOWN_STORAGE_KEY,
    defaultValue: false,
    parse: parseBoolish,
    serialize: serializeBoolish,
  })
  return { includeUnknown, setIncludeUnknown }
}

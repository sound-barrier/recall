import { usePersistedRef, parseBoolish, serializeBoolish } from './usePersistedRef'

export const SHOW_HIDDEN_STORAGE_KEY = 'recall.showHidden'

// Persisted toggle for the "Show hidden matches" control in the
// FilterRail. Default false — soft-deleted matches stay out of sight
// unless the user opts back in (to inspect or unhide them).

export function readStoredShowHidden(): boolean {
  try {
    const stored = localStorage.getItem(SHOW_HIDDEN_STORAGE_KEY)
    return parseBoolish(stored ?? '') ?? false
  } catch (_) {
    return false
  }
}

export function useShowHidden() {
  const { value: showHidden, set: setShowHidden } = usePersistedRef<boolean>({
    key: SHOW_HIDDEN_STORAGE_KEY,
    defaultValue: false,
    parse: parseBoolish,
    serialize: serializeBoolish,
  })
  return { showHidden, setShowHidden }
}

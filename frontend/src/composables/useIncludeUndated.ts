import { ref, onMounted } from 'vue'

export const INCLUDE_UNDATED_STORAGE_KEY = 'recall.includeUndated'

// Persisted toggle for the "Include undated matches" control in the
// FilterRail. Default false — records that pass the matched-view filter
// but lack a parseable data.date are hidden until the user opts in.
// Once the user toggles ON, the preference survives across launches
// (matches the useTheme / useWeekStart pattern).
//
// The storage value is the literal string "true" or "false" so the
// reader can distinguish "set to false" from "unset" cleanly. Anything
// not exactly those two strings falls back to false.
export function readStoredIncludeUndated(): boolean {
  try {
    const stored = localStorage.getItem(INCLUDE_UNDATED_STORAGE_KEY)
    if (stored === 'true') return true
    if (stored === 'false') return false
  } catch (_) {}
  return false
}

export function useIncludeUndated() {
  const includeUndated = ref<boolean>(false)

  function setIncludeUndated(next: boolean) {
    includeUndated.value = next
    try { localStorage.setItem(INCLUDE_UNDATED_STORAGE_KEY, next ? 'true' : 'false') } catch (_) {}
  }

  onMounted(() => {
    includeUndated.value = readStoredIncludeUndated()
  })

  return { includeUndated, setIncludeUndated }
}

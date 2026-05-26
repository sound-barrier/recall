import { ref, onMounted } from 'vue'

export const SHOW_HIDDEN_STORAGE_KEY = 'recall.showHidden'

// Persisted toggle for the "Show hidden matches" control in the
// FilterRail. Default false — soft-deleted matches stay out of sight
// unless the user opts back in (to inspect or unhide them).
//
// Mirrors useIncludeUndated: stores literal "true"/"false" so a
// stored "false" is distinguishable from an unset key.
export function readStoredShowHidden(): boolean {
  try {
    const stored = localStorage.getItem(SHOW_HIDDEN_STORAGE_KEY)
    if (stored === 'true') return true
    if (stored === 'false') return false
  } catch (_) {}
  return false
}

export function useShowHidden() {
  const showHidden = ref<boolean>(false)

  function setShowHidden(next: boolean) {
    showHidden.value = next
    try { localStorage.setItem(SHOW_HIDDEN_STORAGE_KEY, next ? 'true' : 'false') } catch (_) {}
  }

  onMounted(() => {
    showHidden.value = readStoredShowHidden()
  })

  return { showHidden, setShowHidden }
}

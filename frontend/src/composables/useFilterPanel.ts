import { ref, onMounted, onBeforeUnmount } from 'vue'

// All filter field names in the app. Initialises the search-string map
// and serves as the closed set for filterSearch keys.
const FILTER_FIELDS = ['mode', 'type', 'role', 'map', 'hero', 'result', 'sshot'] as const

// Pure decision: should an outside-click close the popover?
// Exported so tests can verify behaviour without a real DOM.
export function shouldCloseOnOutsideClick(
  target: Element | null,
  isOpen: boolean,
): boolean {
  if (!isOpen) return false
  return !target?.closest('.multi-filter')
}

export function useFilterPanel() {
  const openFilter = ref('')

  // Per-field search query for the long rosters (map, hero).
  // Cleared automatically when the popover is opened.
  const filterSearch = ref<Record<string, string>>(
    Object.fromEntries(FILTER_FIELDS.map(f => [f, '']))
  )

  // Toggle a popover open/closed. Opening a second field implicitly
  // closes the first. Clears the field's search string on open so the
  // full roster is visible immediately.
  function toggleFilterPanel(field: string) {
    openFilter.value = openFilter.value === field ? '' : field
    if (openFilter.value && filterSearch.value[field] !== '') {
      filterSearch.value = { ...filterSearch.value, [field]: '' }
    }
  }

  function closeFilterPanel() { openFilter.value = '' }

  function onDocMousedown(e: MouseEvent) {
    if (shouldCloseOnOutsideClick(e.target as Element | null, !!openFilter.value)) {
      openFilter.value = ''
    }
  }

  function onDocKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && openFilter.value) openFilter.value = ''
  }

  onMounted(() => {
    document.addEventListener('mousedown', onDocMousedown)
    document.addEventListener('keydown', onDocKeydown)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocMousedown)
    document.removeEventListener('keydown', onDocKeydown)
  })

  return { openFilter, filterSearch, toggleFilterPanel, closeFilterPanel }
}

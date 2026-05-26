import { ref, onMounted } from 'vue'

export type DensityMode = 'comfortable' | 'compact'
export const DENSITY_STORAGE_KEY = 'recall.densityMode'

// Persisted toggle for the match-list density. Default 'comfortable'
// (the original full card). Switching to 'compact' tightens padding
// + map-name font and inlines E/A/D + damage in the card header so
// high-volume players see at-a-glance stats without expanding every
// card. Per-card expand state is unaffected — orthogonal concern.
//
// Same shape as useTheme / useWeekStart / useIncludeUndated —
// readStored* / set* / onMounted hydrator.
export function readStoredDensityMode(): DensityMode {
  try {
    const stored = localStorage.getItem(DENSITY_STORAGE_KEY)
    if (stored === 'compact' || stored === 'comfortable') return stored
  } catch (_) {}
  return 'comfortable'
}

export function useDensityMode() {
  const densityMode = ref<DensityMode>('comfortable')

  function setDensityMode(next: DensityMode) {
    densityMode.value = next
    try { localStorage.setItem(DENSITY_STORAGE_KEY, next) } catch (_) {}
  }

  function toggleDensityMode() {
    setDensityMode(densityMode.value === 'compact' ? 'comfortable' : 'compact')
  }

  onMounted(() => {
    densityMode.value = readStoredDensityMode()
  })

  return { densityMode, setDensityMode, toggleDensityMode }
}

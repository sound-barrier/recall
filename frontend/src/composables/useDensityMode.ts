import { usePersistedRef, parseEnum } from './usePersistedRef'

export type DensityMode = 'comfortable' | 'compact'
export const DENSITY_STORAGE_KEY = 'recall.densityMode'

// Persisted toggle for the match-list density. Default 'comfortable'
// (the original full card). 'compact' tightens padding + map-name
// font and inlines E/A/D + damage in the card header so high-volume
// players see at-a-glance stats without expanding every card.
// Per-card expand state is unaffected — orthogonal concern.

const parseDensity = parseEnum<DensityMode>('comfortable', 'compact')

export function readStoredDensityMode(): DensityMode {
  try {
    const stored = localStorage.getItem(DENSITY_STORAGE_KEY)
    return parseDensity(stored ?? '') ?? 'comfortable'
  } catch (_) {
    return 'comfortable'
  }
}

export function useDensityMode() {
  const { value: densityMode, set: setDensityMode } = usePersistedRef<DensityMode>({
    key: DENSITY_STORAGE_KEY,
    defaultValue: 'comfortable',
    parse: parseDensity,
  })

  function toggleDensityMode() {
    setDensityMode(densityMode.value === 'compact' ? 'comfortable' : 'compact')
  }

  return { densityMode, setDensityMode, toggleDensityMode }
}

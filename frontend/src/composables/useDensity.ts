import { usePersistedRef } from './usePersistedRef'

// Persisted preference for the matches-list row density. `comfortable`
// is the historical render — 0.55rem padding, 36 px result strip,
// roomy gaps. `compact` tightens vertical rhythm so more rows fit on
// screen without going full data-table mode.
export type Density = 'comfortable' | 'compact'

function parseDensity(raw: string): Density | undefined {
  if (raw === 'comfortable' || raw === 'compact') return raw
  return undefined
}

export function useDensity() {
  const { value: density, set: setDensity } = usePersistedRef<Density>({
    key: 'recall.matchesDensity',
    defaultValue: 'comfortable',
    parse: parseDensity,
  })
  return { density, setDensity }
}

import { usePersistedRef } from './usePersistedRef'

// Persisted preference for the matches-list row density. `comfortable`
// is the historical render — 0.55rem padding, 36 px result strip,
// roomy gaps. `compact` tightens vertical rhythm so more rows fit on
// screen. `data` is a separate renderer entirely — a real <table> with
// sortable column headers + hairline rows (MatchTableRow), not a row-
// spacing override of the leaf-row list.
export type Density = 'comfortable' | 'compact' | 'data'

function parseDensity(raw: string): Density | undefined {
  if (raw === 'comfortable' || raw === 'compact' || raw === 'data') return raw
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

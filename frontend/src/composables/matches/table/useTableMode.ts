import { parseEnum, usePersistedRef } from '@/composables/shared/usePersistedRef'

// Persisted toggle for the data-density view: `flat` is the sortable
// one-row-per-match table; `pivot` swaps that surface for the crosstab
// builder over the SAME narrowed set. Mirrors useDensity — a thin wrapper
// around usePersistedRef so the choice survives reloads and re-hydrates
// across sibling instances.
export type TableMode = 'flat' | 'pivot'

export function useTableMode() {
  const { value: tableMode, set: setTableMode } = usePersistedRef<TableMode>({
    key: 'recall.matchesTableMode',
    defaultValue: 'flat',
    parse: parseEnum('flat', 'pivot'),
  })
  return { tableMode, setTableMode }
}

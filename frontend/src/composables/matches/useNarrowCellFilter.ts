import { computed } from 'vue'

import { useNarrow } from '@/composables/matches/narrow/useNarrow'
import type { PlayModePick, QueuePick } from '@/composables/matches/narrow/matchesNarrow.types'

/**
 * Click-to-filter from a value cell: clicking a map, result, mode, queue, hero
 * or role toggles that narrow dimension. Sorting is the column headers' and the
 * sort/group toolbar's job, never a cell click.
 *
 * Both surfaces that render match rows — the data table and the grouped leaf
 * list — carried their own copy of this, and the copies had already drifted:
 * the six dimensions were tested in a different ORDER, and the two `else`
 * arms fell through to different pick functions (role in one, result in the
 * other). Both were correct, but only because each chain happened to be
 * exhaustive over its own union; the moment one gained a seventh dimension the
 * other's fallthrough would have started silently filtering the wrong column.
 */
export type FilterableField = 'map' | 'result' | 'mode' | 'queue' | 'hero' | 'role'

export function useNarrowCellFilter() {
  const narrow = useNarrow()

  // A registry rather than an if-chain, so a seventh dimension is a compile
  // error here instead of a wrong filter somewhere else: Record over the union
  // will not typecheck until every member has an entry.
  const pickFor: Record<FilterableField, (value: string) => void> = {
    map: (value) => narrow.pickMap(value),
    result: (value) => narrow.pickResult(value),
    mode: (value) => narrow.pickPlayMode(value as PlayModePick),
    queue: (value) => narrow.pickQueue(value as QueuePick),
    hero: (value) => narrow.pickHero(value),
    role: (value) => narrow.pickRole(value),
  }

  function onFilterCell(field: FilterableField, value: string) {
    if (!value) return
    pickFor[field](value)
  }

  // Passed down to each row so a cell whose value is currently filtered lights
  // up. Read-only on purpose: a row displays the picks, it does not add to them.
  const activeFilters = computed(() => ({
    maps: narrow.pickedMaps.value as ReadonlySet<string>,
    modes: narrow.pickedPlayModes.value as ReadonlySet<string>,
    queues: narrow.pickedQueues.value as ReadonlySet<string>,
    heroes: narrow.pickedHeroes.value as ReadonlySet<string>,
    roles: narrow.pickedRoles.value as ReadonlySet<string>,
    results: narrow.pickedResults.value as ReadonlySet<string>,
  }))

  return { onFilterCell, activeFilters }
}

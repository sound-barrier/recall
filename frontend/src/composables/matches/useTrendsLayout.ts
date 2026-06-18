import { computed } from 'vue'

import { usePersistedRef } from '@/composables/shared/usePersistedRef'

// The Trends section's chart ids, in default display order.
const TREND_CHART_IDS = [
  'rank-ladder',
  'rolling-winrate',
  'rank-delta',
  'cumulative-net',
  'modifiers',
] as const
export type TrendChartId = typeof TREND_CHART_IDS[number]

function isKnownId(x: unknown): x is TrendChartId {
  return typeof x === 'string' && (TREND_CHART_IDS as readonly string[]).includes(x)
}

function parseIds(raw: string): TrendChartId[] | undefined {
  try {
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return undefined
    return [...new Set(arr.filter(isKnownId))]
  } catch {
    return undefined
  }
}

// The Trends section's per-user layout — which charts show and in what
// order — persisted (mirroring the dossier widget layout) so it survives
// reloads. Two arrays: `order` (visible charts, in display order) and
// `hidden`. Removing a chart hides it; the "+ add" chips bring it back;
// the ⠿ grip drag/keyboard reorders it.
export function useTrendsLayout() {
  const { value: order, set: setOrder } = usePersistedRef<TrendChartId[]>({
    key: 'recall.trends.order',
    defaultValue: [],
    parse: parseIds,
    serialize: (v) => JSON.stringify(v),
  })
  const { value: hidden, set: setHidden } = usePersistedRef<TrendChartId[]>({
    key: 'recall.trends.hidden',
    defaultValue: [],
    parse: parseIds,
    serialize: (v) => JSON.stringify(v),
  })

  // Visible charts in display order: the persisted order minus hidden, then
  // any known chart not yet placed (e.g. one added in a newer app version)
  // appended in its default position so it surfaces rather than vanishing.
  const visibleIds = computed<TrendChartId[]>(() => {
    const placed = order.value.filter((id) => !hidden.value.includes(id))
    const missing = TREND_CHART_IDS.filter((id) => !order.value.includes(id) && !hidden.value.includes(id))
    return [...placed, ...missing]
  })
  const hiddenIds = computed<TrendChartId[]>(() => TREND_CHART_IDS.filter((id) => hidden.value.includes(id)))

  const isVisible = (id: TrendChartId): boolean => !hidden.value.includes(id)

  function hide(id: TrendChartId): void {
    setOrder(visibleIds.value.filter((x) => x !== id))
    if (!hidden.value.includes(id)) setHidden([...hidden.value, id])
  }
  function show(id: TrendChartId): void {
    setHidden(hidden.value.filter((x) => x !== id))
    setOrder([...visibleIds.value.filter((x) => x !== id), id])
  }

  // Reorder the visible list — `toIdx` is the post-removal target index
  // useDragReorder hands us (it already accounts for the source splice).
  function move(fromIdx: number, toIdx: number): void {
    const ids = [...visibleIds.value]
    if (fromIdx < 0 || fromIdx >= ids.length || toIdx < 0 || toIdx > ids.length) return
    const [moved] = ids.splice(fromIdx, 1)
    if (!moved) return
    ids.splice(toIdx, 0, moved)
    setOrder(ids)
  }

  return { visibleIds, hiddenIds, isVisible, hide, show, move }
}

import { usePersistedRef } from '@/composables/shared/usePersistedRef'

// The Trends section's chart ids, in display order.
const TREND_CHART_IDS = [
  'rank-ladder',
  'rolling-winrate',
  'rank-delta',
  'cumulative-net',
  'modifiers',
] as const
export type TrendChartId = typeof TREND_CHART_IDS[number]

function parseHidden(raw: string): TrendChartId[] | undefined {
  try {
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return undefined
    return arr.filter((x): x is TrendChartId => typeof x === 'string' && (TREND_CHART_IDS as readonly string[]).includes(x))
  } catch {
    return undefined
  }
}

// Which trend charts the user has hidden — persisted (as the list of
// HIDDEN ids) so the choice survives reloads, mirroring how the dossier
// widget layout persists. Removing a chart hides it; the "+ add" chips
// in the Trends header bring it back.
export function useTrendsLayout() {
  const { value: hidden, set } = usePersistedRef<TrendChartId[]>({
    key: 'recall.trends.hidden',
    defaultValue: [],
    parse: parseHidden,
    serialize: (v) => JSON.stringify(v),
  })

  const isVisible = (id: TrendChartId): boolean => !hidden.value.includes(id)
  function hide(id: TrendChartId): void {
    if (!hidden.value.includes(id)) set([...hidden.value, id])
  }
  function show(id: TrendChartId): void {
    set(hidden.value.filter((x) => x !== id))
  }

  return { hidden, isVisible, hide, show }
}

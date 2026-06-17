import { computed, toValue, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'

import type { MatchRecord } from '@/api'
import {
  per10TrendSeries,
  rollingWinrateSeries,
  srTrendSeries,
  statTrendSeries,
  type StatKey,
  type TrendSeries,
} from '@/match/match-trends-helpers'

// Reactive time-series over the narrowed match set. Bedrock series
// (SR, per-10) are precomputed refs; the parameterised series take a
// MaybeRefOrGetter so the Trends section can wire its stat/window
// selectors straight through — same shape as useDossierQueries. Folded
// into useMatchesDossier's return so consumers reach it via useDossier.
export function useMatchesTrends(records: Readonly<Ref<MatchRecord[]>>) {
  const srTrends = computed<TrendSeries[]>(() => srTrendSeries(records.value))
  const per10Trends = computed<TrendSeries[]>(() => per10TrendSeries(records.value))

  function statTrend(stat: MaybeRefOrGetter<StatKey>): ComputedRef<TrendSeries> {
    return computed(() => statTrendSeries(records.value, toValue(stat)))
  }

  function rollingWinrate(window: MaybeRefOrGetter<number>): ComputedRef<TrendSeries> {
    return computed(() => rollingWinrateSeries(records.value, toValue(window)))
  }

  return { srTrends, per10Trends, statTrend, rollingWinrate }
}

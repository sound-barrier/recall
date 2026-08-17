import { computed, toValue, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import {
  currentRankByRole,
  rankLadderSeries,
  rankDeltaSeries,
  rankPercentileSeries,
  cumulativeNetRecordSeries,
  modifierFrequencySeries,
  combatSeries,
  rollingWinrateSeries,
  heroRollingWinrateSeries,
  mapRollingWinrateSeries,
  type RankNow,
  type RankSeries,
  type TrendSeries,
} from '@/match/trends/match-trends-helpers'

// Reactive time-series over the narrowed match set, split by role bucket.
// `rankLadder` is a precomputed ref; `rollingWinrate` takes a
// MaybeRefOrGetter so the Trends section can wire its window selector
// straight through. Folded into useMatchesDossier's return so consumers
// reach it via useDossier.
export function useMatchesTrends(records: Readonly<Ref<MatchRecord[]>>) {
  const rankLadder = computed<RankSeries[]>(() => rankLadderSeries(records.value))
  const currentRank = computed<RankNow[]>(() => currentRankByRole(records.value))
  const rankDelta = computed<TrendSeries[]>(() => rankDeltaSeries(records.value))
  const rankPercentile = computed<TrendSeries[]>(() => rankPercentileSeries(records.value))
  const cumulativeNet = computed<TrendSeries[]>(() => cumulativeNetRecordSeries(records.value))
  const modifierFrequency = computed<TrendSeries[]>(() => modifierFrequencySeries(records.value))
  const combat = computed<TrendSeries[]>(() => combatSeries(records.value))

  // Per-hero rolling win-rate over the set's most-played heroes.
  function heroRollingWinrate(window: MaybeRefOrGetter<number>): ComputedRef<TrendSeries[]> {
    return computed(() => heroRollingWinrateSeries(records.value, toValue(window)))
  }

  // Per-map rolling win-rate over the set's most-played maps.
  function mapRollingWinrate(window: MaybeRefOrGetter<number>): ComputedRef<TrendSeries[]> {
    return computed(() => mapRollingWinrateSeries(records.value, toValue(window)))
  }

  function rollingWinrate(window: MaybeRefOrGetter<number>): ComputedRef<TrendSeries[]> {
    return computed(() => rollingWinrateSeries(records.value, toValue(window)))
  }

  return { rankLadder, currentRank, rankDelta, rankPercentile, cumulativeNet, modifierFrequency, combat, rollingWinrate, heroRollingWinrate, mapRollingWinrate }
}

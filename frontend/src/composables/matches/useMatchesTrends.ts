import { computed, toValue, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'

import type { MatchRecord } from '@/api'
import {
  currentRankByRole,
  rankLadderSeries,
  rollingWinrateSeries,
  type RankNow,
  type RankSeries,
  type TrendSeries,
} from '@/match/match-trends-helpers'

// Reactive time-series over the narrowed match set, split by role bucket.
// `rankLadder` is a precomputed ref; `rollingWinrate` takes a
// MaybeRefOrGetter so the Trends section can wire its window selector
// straight through. Folded into useMatchesDossier's return so consumers
// reach it via useDossier.
export function useMatchesTrends(records: Readonly<Ref<MatchRecord[]>>) {
  const rankLadder = computed<RankSeries[]>(() => rankLadderSeries(records.value))
  const currentRank = computed<RankNow[]>(() => currentRankByRole(records.value))

  function rollingWinrate(window: MaybeRefOrGetter<number>): ComputedRef<TrendSeries[]> {
    return computed(() => rollingWinrateSeries(records.value, toValue(window)))
  }

  return { rankLadder, currentRank, rollingWinrate }
}

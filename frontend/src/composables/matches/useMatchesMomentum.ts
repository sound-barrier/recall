import { computed, toValue, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import { avgGameLengthMinutes } from '@/match/match-stats-helpers'
import {
  firstGameOfSessionWinrate,
  formDelta as computeFormDelta,
  leaverRate,
  netRankProgress,
  sessionCount,
  winrateAfterLossStreak,
  winrateAfterResult,
  winrateBySessionIndex,
  type FormDelta,
  type LeaverRate,
  type RateSample,
  type SessionIndexBreakdown,
} from '@/match/match-momentum-helpers'
import { tiltEpisodes, type TiltEpisodes } from '@/match/elo-streaks'

// "Net rank this week" anchors on the last seven days of play.
const NET_RANK_DAYS = 7

// Reactive behavioural aggregates over the narrowed match set — tilt /
// momentum + climb / session stats. Folded into useMatchesDossier's
// return so the KPI widgets reach them via useDossier (same shape as
// useMatchesTrends).
export function useMatchesMomentum(records: Readonly<Ref<MatchRecord[]>>) {
  const winrateAfterLoss = computed<RateSample>(() => winrateAfterResult(records.value, 'defeat'))
  const winrateAfterWin = computed<RateSample>(() => winrateAfterResult(records.value, 'victory'))
  const firstGameWinrate = computed<RateSample>(() => firstGameOfSessionWinrate(records.value))
  const netRankWeek = computed<number>(() => netRankProgress(records.value, NET_RANK_DAYS))
  const avgGameLength = computed<number | null>(() => avgGameLengthMinutes(records.value))
  const leaverStats = computed<LeaverRate>(() => leaverRate(records.value))
  const sessions = computed<number>(() => sessionCount(records.value))
  const tiltQueues = computed<TiltEpisodes>(() => tiltEpisodes(records.value))
  const sessionDepth = computed<SessionIndexBreakdown>(() => winrateBySessionIndex(records.value))

  // Parameterized helpers — the same MaybeRefOrGetter shape as the
  // dossier queries, so widgets wire their useWidgetConfig knobs through.
  function formDelta(opts: MaybeRefOrGetter<{ window: number }>): ComputedRef<FormDelta> {
    return computed(() => computeFormDelta(records.value, toValue(opts).window))
  }
  function lossStreakRecovery(opts: MaybeRefOrGetter<{ minStreak: number }>): ComputedRef<RateSample> {
    return computed(() => winrateAfterLossStreak(records.value, toValue(opts).minStreak))
  }

  return {
    winrateAfterLoss, winrateAfterWin, firstGameWinrate, netRankWeek,
    avgGameLength, leaverStats, sessions, tiltQueues,
    sessionDepth, formDelta, lossStreakRecovery,
  }
}

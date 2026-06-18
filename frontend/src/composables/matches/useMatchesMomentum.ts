import { computed, type Ref } from 'vue'

import type { MatchRecord } from '@/api'
import { avgGameLengthMinutes } from '@/match/match-stats-helpers'
import {
  firstGameOfSessionWinrate,
  leaverRate,
  netRankProgress,
  sessionCount,
  winrateAfterResult,
  type LeaverRate,
  type RateSample,
} from '@/match/match-momentum-helpers'

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

  return { winrateAfterLoss, winrateAfterWin, firstGameWinrate, netRankWeek, avgGameLength, leaverStats, sessions }
}

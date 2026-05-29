import { computed, type Ref } from 'vue'
import type { MatchRecord } from '../api'

// Pure KPI / breakdown computations for the Matches dossier.
// Extracted from MatchesView so the tally math (winrate excluding
// draws from the denominator, top-N breakdowns, leaver-tally
// exclusion) is testable in isolation. No DOM, no Vue components —
// just `Ref<MatchRecord[]>` in, `ComputedRef` out.

export type LeaverHandling = 'include' | 'exclude-tally' | 'hide'

export interface WinLossDraw {
  w: number
  l: number
  d: number
  total: number
}

export interface BreakdownEntry {
  key: string
  total: number
  // Per-row winrate as an integer percentage. Draws excluded from
  // the denominator (same convention as the headline winrate).
  winrate: number
}

export function useMatchesDossier(
  records: Readonly<Ref<MatchRecord[]>>,
  leaverHandling: Readonly<Ref<LeaverHandling>>,
) {
  // 'exclude-tally' drops leaver-annotated records from the KPIs
  // (W/L/D + winrate) only. The leaves list still shows them — the
  // user explicitly asked for "drop from tally" not "hide". 'hide'
  // is upstream of this composable: the caller is expected to have
  // already filtered those rows out of `records`.
  const tallyRecords = computed(() => {
    if (leaverHandling.value === 'exclude-tally') {
      return records.value.filter((r) => !r.annotation?.leaver)
    }
    return records.value
  })

  const wld = computed<WinLossDraw>(() => {
    let w = 0, l = 0, d = 0
    for (const r of tallyRecords.value) {
      const result = r.data?.result
      if (result === 'victory') w++
      else if (result === 'defeat') l++
      else if (result === 'draw') d++
    }
    return { w, l, d, total: w + l + d }
  })

  const winrate = computed<number | null>(() => {
    const t = wld.value
    const denom = t.w + t.l
    return denom === 0 ? null : Math.round((t.w / denom) * 100)
  })

  // Generic top-N-by-count builder. The full record set drives the
  // breakdown (NOT tallyRecords) so a user filtering "exclude-tally"
  // for leavers still sees leaver-affected maps in the breakdown —
  // the per-cell winrate then reads pre-tally-exclusion. We can
  // reconsider that if a user reports it as confusing; for now the
  // simpler "everything counts here" rule wins.
  function topByCount(getter: (r: MatchRecord) => string | undefined, limit = 5): BreakdownEntry[] {
    const counts = new Map<string, { total: number; w: number; l: number }>()
    for (const r of records.value) {
      const key = getter(r)
      if (!key) continue
      const entry = counts.get(key) ?? { total: 0, w: 0, l: 0 }
      entry.total++
      if (r.data?.result === 'victory') entry.w++
      else if (r.data?.result === 'defeat') entry.l++
      counts.set(key, entry)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, limit)
      .map(([key, c]) => ({
        key,
        total: c.total,
        winrate: c.w + c.l === 0 ? 0 : Math.round((c.w / (c.w + c.l)) * 100),
      }))
  }

  const topMaps   = computed(() => topByCount((r) => r.data?.map))
  const topHeroes = computed(() => topByCount((r) => r.data?.hero))

  return { wld, winrate, topMaps, topHeroes }
}

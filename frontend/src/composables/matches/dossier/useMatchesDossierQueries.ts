import { computed, toValue, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'
import type { MatchRecord } from '@/api-client'
import type { WeekStart } from '@/match/match-time-helpers'
import { dayTimeWinrateGrid, type WinrateGrid } from '@/match/trends/match-trends-helpers'
import { lossQuality, type LossQuality } from '@/match/dossier/match-loss-quality'
import {
  analyzeHeroPool,
  heroCountBuckets as computeHeroCountBuckets,
  type HeroCountBucket,
  type HeroPoolAnalysis,
} from '@/match/dossier/match-hero-pool-helpers'
import {
  bestWinrateHeroRecord,
  dayOfWeekBucketRows,
  heroGameModeCells,
  mapCountRows,
  mapRoleCells,
  modifierBreakdownRows,
  modifierRecordFor,
  mostPlayedHeroRecord,
  recentMatchRows,
  timeOfDayBucketRows,
  topByCountRows,
  topHeroesByMinutesRows,
  winrateByRows,
  withWhomRows,
} from '@/match/dossier/match-dossier-aggregate'
import {
  type BreakdownEntry,
  type ModifierRecord,
  type HeroBreakdownEntry,
  type MostPlayedHero,
  type BestWinrateHero,
  type BucketEntry,
  type HeroGameModeCell,
  type MapCountRow,
  type MapRoleCell,
  type RecentMatchRow,
  type HeroRoleResolver,
  monthsAgoISO,
} from '@/composables/matches/dossier/useMatchesDossier.types'

// `windowMonths` scopes a query to a trailing time window (the bands'
// 1M/3M/6M/12M toggle, mirroring the Campaign Log) — records older
// than the cutoff, OR with no date, drop out. 0 (the default) means
// all-time, rendered as the empty cutoff the kernels treat as "admit
// everything".
function windowCutoff(windowMonths: number): string {
  return windowMonths > 0 ? monthsAgoISO(windowMonths) : ''
}

// The dossier's parameterized query-helper tier (the panel-options
// side). Each helper takes a MaybeRefOrGetter<Opts> and
// opens its own computed() so widgets can wire reactive config through
// and share Vue's reactive cache. Split out of useMatchesDossier so the
// composable file holds the bedrock refs and this one holds the
// config-driven queries; both close over the same narrowed records via
// the args passed in. The aggregation loops themselves are pure kernels
// in @/match/dossier/match-dossier-aggregate — each helper here only picks the
// record set (records vs tallyRecords, a deliberate per-widget choice)
// and unwraps its reactive opts.
export function useDossierQueries(
  records: Readonly<Ref<MatchRecord[]>>,
  tallyRecords: ComputedRef<MatchRecord[]>,
  heroRole?: HeroRoleResolver,
  weekStart?: Readonly<Ref<WeekStart>>,
) {
  // Generic top-N-by-count query. The full record set drives the
  // breakdown (NOT tallyRecords) so a user filtering "exclude-tally"
  // for leavers still sees leaver-affected maps in the breakdown —
  // the per-cell winrate then reads pre-tally-exclusion. We can
  // reconsider that if a user reports it as confusing; for now the
  // simpler "everything counts here" rule wins.
  //
  // Drives the top-maps, top-heroes-by-count, and top-game-modes
  // widgets — each passes its own getter + limit. The widget's
  // useWidgetConfig output supplies `limit`; PR B callers hardcode
  // it to match today's behavior.
  function topByCount(
    opts: MaybeRefOrGetter<{ getter: (r: MatchRecord) => string | undefined; limit: number }>,
  ): ComputedRef<BreakdownEntry[]> {
    return computed(() => {
      const { getter, limit } = toValue(opts)
      return topByCountRows(records.value, getter, limit)
    })
  }

  // Win rate by an arbitrary dimension (hero / map / role), ranked
  // best → worst by Wilson lower bound (see the kernel). Uses
  // tallyRecords so the leaver-handling preference is honored. Drives
  // the opt-in win-rate-by-hero / -map / -role widgets — each passes
  // its getter.
  function winrateBy(
    opts: MaybeRefOrGetter<{ getter: (r: MatchRecord) => string | undefined; minMatches: number; limit: number }>,
  ): ComputedRef<BreakdownEntry[]> {
    return computed(() => {
      const { getter, minMatches, limit } = toValue(opts)
      return winrateByRows(tallyRecords.value, getter, minMatches, limit)
    })
  }

  // Loss-quality buckets over the narrowed set's defeats (close /
  // normal / stomp per match-loss-quality's margin rule). `unscored`
  // counts defeats whose final_score didn't classify, so the widget
  // can be honest about coverage instead of silently shrinking the
  // denominator.
  function lossQualityBreakdown(): ComputedRef<{ rows: BreakdownEntry[]; unscored: number }> {
    return computed(() => {
      const counts: Record<LossQuality, number> = { close: 0, normal: 0, stomp: 0 }
      let unscored = 0
      let losses = 0
      for (const r of records.value) {
        if (r.data?.result !== 'defeat') continue
        losses++
        const q = lossQuality(r.data?.result, r.data?.final_score)
        if (q === null) unscored++
        else counts[q]++
      }
      const rows = (['close', 'normal', 'stomp'] as const).map((key) => ({
        key,
        total: counts[key],
        winrate: 0,
        share: losses === 0 ? 0 : Math.round((counts[key] / losses) * 100),
      }))
      return { rows, unscored }
    })
  }

  // Count + win-rate per non-result modifier — the rank-update pills.
  // Full record set (same "everything counts here" rule as topByCount).
  // Drives the opt-in "Match modifiers" breakdown.
  function modifierBreakdown(
    opts: MaybeRefOrGetter<{ limit: number }>,
  ): ComputedRef<BreakdownEntry[]> {
    return computed(() => modifierBreakdownRows(records.value, toValue(opts).limit))
  }

  // Count + win-rate for ONE modifier — the Uphill Battle / Reversal
  // KPI tiles. Null when the modifier never appears in the set.
  function modifierRecord(
    opts: MaybeRefOrGetter<{ modifier: string }>,
  ): ComputedRef<ModifierRecord | null> {
    return computed(() => modifierRecordFor(records.value, toValue(opts).modifier))
  }

  // Win rate by teammate (annotation.members, with a "Solo" bucket).
  // Drives the opt-in "Win rate by teammate" widget.
  function withWhomBreakdown(
    opts: MaybeRefOrGetter<{ limit: number }>,
  ): ComputedRef<BreakdownEntry[]> {
    return computed(() => withWhomRows(records.value, toValue(opts).limit))
  }

  // Hero × Map-type breakdown — the heatmap widget pivots this flat
  // list into a 2-D grid (rows = heroes, columns = game modes). Limit
  // applies to the hero axis (top-N by total play count); the
  // game-mode axis is always all 6 canonical modes.
  function heroGameModeCounts(
    opts?: MaybeRefOrGetter<{ heroLimit?: number; minMatches?: number; windowMonths?: number }>,
  ): ComputedRef<HeroGameModeCell[]> {
    return computed(() => {
      const { heroLimit = 8, minMatches: _minMatches = 0, windowMonths = 0 } = opts ? toValue(opts) ?? {} : {}
      void _minMatches // reserved for future per-cell empty-state floor
      return heroGameModeCells(records.value, heroLimit, windowCutoff(windowMonths))
    })
  }

  // Top heroes by SUMMED play time across every heroes_played[]
  // entry — not by primary-hero match count. Default limit is 3 (vs
  // topByCount widgets' typical 5) because the time-based row carries
  // a longer label ("7h32min") that needs room to breathe in the
  // breakdown grid.
  function topHeroesByMinutes(
    opts: MaybeRefOrGetter<{ limit: number }>,
  ): ComputedRef<HeroBreakdownEntry[]> {
    return computed(() => topHeroesByMinutesRows(records.value, toValue(opts).limit))
  }

  // Win-rate annotation for the Most-played-hero KPI tile. Sources
  // the hero name from topHeroesByMinutes[0] (time-ranked, full
  // record set) and the W/L counts from tallyRecords where that
  // hero's percent_played cleared the `minPercentPlayed` threshold.
  //
  // Default threshold matches DEFAULT_MOST_PLAYED_HERO_THRESHOLD
  // so a 20%+ play attribution counts toward the winrate without
  // the user having to opt in. The widget's config exposes 10/15/
  // 20/25/30% choices in PR C.
  function mostPlayedHero(
    opts: MaybeRefOrGetter<{ minPercentPlayed: number }>,
  ): ComputedRef<MostPlayedHero | null> {
    // Captured top-hero ref so the query is reactive over both the
    // headline hero pick AND the threshold knob. limit=1 — we only
    // need the leader.
    const topRef = topHeroesByMinutes({ limit: 1 })
    return computed(() => {
      const top = topRef.value[0]
      if (!top) return null
      return mostPlayedHeroRecord(tallyRecords.value, top.key, toValue(opts).minPercentPlayed)
    })
  }

  // Map × Role performance — the data behind the Geography band.
  function mapRoleCounts(
    opts?: MaybeRefOrGetter<{ windowMonths?: number }>,
  ): ComputedRef<MapRoleCell[]> {
    return computed(() => {
      const { windowMonths = 0 } = opts ? toValue(opts) ?? {} : {}
      return mapRoleCells(records.value, heroRole, windowCutoff(windowMonths))
    })
  }

  // Per-map tally over the (narrowed) set — the Hero × Game-Mode
  // band's "maps" drill level.
  function mapCounts(
    opts?: MaybeRefOrGetter<{ windowMonths?: number }>,
  ): ComputedRef<MapCountRow[]> {
    return computed(() => {
      const { windowMonths = 0 } = opts ? toValue(opts) ?? {} : {}
      return mapCountRows(records.value, windowCutoff(windowMonths))
    })
  }

  // Recent individual matches over the (narrowed) set — the band's
  // deepest drill level, newest-played first, capped to `count`
  // (default 8).
  function recentMatches(
    opts?: MaybeRefOrGetter<{ count?: number; windowMonths?: number }>,
  ): ComputedRef<RecentMatchRow[]> {
    return computed(() => {
      const { count = 8, windowMonths = 0 } = opts ? toValue(opts) ?? {} : {}
      return recentMatchRows(records.value, count, windowCutoff(windowMonths))
    })
  }

  // Best hero by winrate over tallyRecords, gated to ≥
  // `minPercentPlayed` percent play AND ≥ `minMatches` decisive
  // qualifying matches. Null when no hero clears both gates.
  //
  // Two knobs: PR C's widget config lets the user move either gate
  // independently. The defaults match the long-standing
  // MOST_PLAYED_HERO_THRESHOLD (20%) + BEST_WINRATE_HERO_MIN_MATCHES
  // (3) constants exactly so first-hydrate is a no-op.
  function bestWinrateHero(
    opts: MaybeRefOrGetter<{ minPercentPlayed: number; minMatches: number }>,
  ): ComputedRef<BestWinrateHero | null> {
    return computed(() => {
      const { minPercentPlayed, minMatches } = toValue(opts)
      return bestWinrateHeroRecord(tallyRecords.value, minPercentPlayed, minMatches)
    })
  }

  // Time-of-day distribution — parameterizable bucket count over the
  // `data.finished_at` HH:MM string. 6 buckets (4-hour windows) is the
  // historical default; PR C exposes 12 (2-hour) and 24 (1-hour)
  // choices. Volume reads the full record set; the win-rate judgment
  // follows the exclude-tally rule via tallyRecords.
  function timeOfDayBuckets(
    opts: MaybeRefOrGetter<{ bucketCount: 6 | 12 | 24 }>,
  ): ComputedRef<BucketEntry[]> {
    return computed(() => timeOfDayBucketRows(records.value, tallyRecords.value, toValue(opts).bucketCount))
  }

  // Day-of-week distribution — seven buckets rotated to respect the
  // user's useWeekStart setting (Sun=0 .. Sat=6) OR a per-widget
  // override passed via opts.weekStartOverride. The override exists
  // so power users can pin one widget to a different week start than
  // the global preference (e.g. comparing a Monday-anchored scrim
  // week against the rest of the dossier's Sunday calendar).
  function dayOfWeekBuckets(
    opts: MaybeRefOrGetter<{ weekStartOverride?: WeekStart }> = { weekStartOverride: undefined },
  ): ComputedRef<BucketEntry[]> {
    return computed(() => {
      const { weekStartOverride } = toValue(opts)
      const start = weekStartOverride ?? weekStart?.value ?? 0
      return dayOfWeekBucketRows(records.value, tallyRecords.value, start)
    })
  }

  // Day-of-week × time-of-day win-rate grid for the Trends "best times to
  // play" heatmap. Reuses the dossier's week-start rotation so the rows
  // match the calendar setting the day-of-week breakdown uses.
  function dayTimeWinrate(
    opts: MaybeRefOrGetter<{ bucketCount: 6 | 12 | 24 }>,
  ): ComputedRef<WinrateGrid> {
    return computed(() => dayTimeWinrateGrid(records.value, toValue(opts).bucketCount, weekStart?.value ?? 0))
  }

  // Recent results — last N decisive (W / L / D) results in
  // newest-first order. The widget renders these as small colored
  // pills so the user reads "I just won, lost, lost, won, won" at
  // a glance. PR C's config lets the user pick 3 / 5 / 10.
  function recentResults(
    opts: MaybeRefOrGetter<{ count: number }>,
  ): ComputedRef<('victory' | 'defeat' | 'draw')[]> {
    return computed(() => {
      const { count } = toValue(opts)
      return tallyRecords.value
        .slice()
        .sort((a, b) => (b.parsed_at ?? '').localeCompare(a.parsed_at ?? ''))
        .map((r) => r.data?.result)
        .filter((r): r is 'victory' | 'defeat' | 'draw' =>
          r === 'victory' || r === 'defeat' || r === 'draw')
        .slice(0, count)
    })
  }

  // Hero-swap discipline: games bucketed by meaningful-hero count. Iterates
  // tallyRecords so the leaver 'Drop from tally' setting is respected.
  function heroCountBuckets(
    opts: MaybeRefOrGetter<{ thresholdPct: number }>,
  ): ComputedRef<HeroCountBucket[]> {
    return computed(() => computeHeroCountBuckets(tallyRecords.value, toValue(opts).thresholdPct))
  }

  // The derived hero pool + in/out split + out-of-pool hero records.
  function heroPool(
    opts: MaybeRefOrGetter<{ thresholdPct: number }>,
  ): ComputedRef<HeroPoolAnalysis> {
    return computed(() => analyzeHeroPool(tallyRecords.value, toValue(opts).thresholdPct, (h) => heroRole?.(h ?? '') ?? ''))
  }

  return {
    topByCount,
    winrateBy,
    heroCountBuckets,
    heroPool,
    modifierBreakdown,
    lossQualityBreakdown,
    modifierRecord,
    withWhomBreakdown,
    heroGameModeCounts,
    mapRoleCounts,
    mapCounts,
    recentMatches,
    topHeroesByMinutes,
    mostPlayedHero,
    bestWinrateHero,
    timeOfDayBuckets,
    dayOfWeekBuckets,
    dayTimeWinrate,
    recentResults,
  }
}

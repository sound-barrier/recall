import { render, type RenderResult } from '@testing-library/vue'
import { computed, type Component, type ComputedRef } from 'vue'
import type { MatchRecord } from '@/api-client'
import { DOSSIER_KEY, FULL_DOSSIER_KEY } from '@/composables/dashboard/useDossier'
import { NARROW_KEY, type NarrowApi } from '@/composables/matches/narrow/useNarrow'
import { installMemoryLocalStorage } from '@/test-utils/localStorage'
import type {
  AverageKDA,
  BestWinrateHero,
  BreakdownEntry,
  BucketEntry,
  CurrentStreak,
  DaysSinceLastReview,
  HeroBreakdownEntry,
  MapRoleCell,
  MatchesDossier,
  ModifierRecord,
  MostPlayedHero,
  ReviewedCount,
  RoleBreakdownEntry,
  TotalTimePlayed,
  WinLossDraw,
  WLDSinceLastReview,
} from '@/composables/matches/dossier/useMatchesDossier'
import type { RankNow } from '@/match/trends/match-trends-helpers'
import type { FormDelta, RateSample, LeaverRate, SessionIndexBreakdown } from '@/match/dossier/match-momentum-helpers'
import type { TiltEpisodes } from '@/match/elo/elo-streaks'
import type { HeroCountBucket, HeroPoolAnalysis } from '@/match/dossier/match-hero-pool-helpers'
import type { BaselineDelta, PerformanceVsRank, ClimbVelocity } from '@/match/dossier/match-baseline-helpers'
import type { SRHeroRow, SRVelocity } from '@/match/dossier/match-sr-helpers'
import type { QueueGapSplit } from '@/match/dossier/match-queue-gap-helpers'
import type { HeroConcentration } from '@/match/dossier/match-hero-pool-helpers'

// Nothing read either side — the shape every baseline widget must survive.
const EMPTY_BASELINE: BaselineDelta = {
  recentRate: null, baselineRate: null, sigma: null, pValue: null, recentN: 0, baselineN: 0,
}

// Empty pool analysis for widgets that don't seed heroPool.
const EMPTY_POOL: HeroPoolAnalysis = {
  pool: [],
  split: { pure: { games: 0, wins: 0, decisive: 0, winrate: 0 }, out: { games: 0, wins: 0, decisive: 0, winrate: 0 } },
  outHeroes: [],
}

// Per-widget test helper that:
//   1. Stubs localStorage so useWidgetConfig hydrates cleanly (the
//      happy-dom default is no-op, which would break the persisted-
//      pref round-trip every widget runs in setup).
//   2. Seeds optional config overrides for the widget under test.
//   3. Provides a mock dossier under DOSSIER_KEY so useDossier()
//      returns the per-test bedrock/query stubs.
//   4. Renders the widget via Testing Library. Widgets render fragment
//      roots (multiple top-level nodes), so run queries through
//      `screen` / the returned baseElement-bound queries — never on
//      `container` alone.
//
// The dossier override is a SHALLOW Partial<MatchesDossier> — each
// override field becomes the literal value the widget sees (refs
// auto-wrap, query helpers return a plain computed). Fields the
// widget doesn't read can be omitted entirely.

type DossierOverride = {
  // Bedrock — pass the inner value; helper wraps in a computed ref.
  records?:             MatchRecord[]
  winrate?:             number | null
  wld?:                 WinLossDraw
  totalTimePlayed?:     TotalTimePlayed
  averageKDA?:          AverageKDA | null
  reviewedCount?:       ReviewedCount
  daysSinceLastReview?: DaysSinceLastReview
  wldSinceLastReview?:  WLDSinceLastReview | null
  currentStreak?:       CurrentStreak
  longestWinStreak?:    number
  topRoles?:            RoleBreakdownEntry[]
  playModeBreakdown?:   BreakdownEntry[]
  // Query helper — pass the result; helper yields a function returning
  // a computed wrapping it (window opts ignored in tests).
  mapRoleCounts?:       MapRoleCell[]
  // Query helpers — pass the result and the helper returns a function
  // that yields a computed wrapping that value (ignoring the opts
  // — tests don't usually need to assert opts pass-through here;
  // that's covered in the dossier suite).
  topByCount?:        BreakdownEntry[]
  withWhomBreakdown?: BreakdownEntry[]
  topHeroesByMinutes?: HeroBreakdownEntry[]
  mostPlayedHero?:    MostPlayedHero | null
  bestWinrateHero?:   BestWinrateHero | null
  timeOfDayBuckets?:  BucketEntry[]
  dayOfWeekBuckets?:  BucketEntry[]
  recentResults?:     ('victory' | 'defeat' | 'draw')[]
  heroGameModeCounts?: Array<{ hero: string; gameMode: string; wins: number; losses: number; draws: number; total: number; winrate: number }>
  mapCounts?:          Array<{ map: string; wins: number; losses: number; draws: number; total: number; winrate: number }>
  recentMatches?:      Array<{ matchKey: string; date: string; finishedAt: string; result: string; map: string }>
  // Query helper — win-rate-by-X widgets.
  winrateBy?:          BreakdownEntry[]
  // Query helpers — hero-swap discipline widgets.
  heroCountBuckets?:   HeroCountBucket[]
  heroPool?:           HeroPoolAnalysis
  // Query helpers — modifier widgets.
  modifierBreakdown?:  BreakdownEntry[]
  modifierRecord?:     ModifierRecord | null
  // Bedrock — current rank per role.
  currentRank?:        RankNow[]
  // Bedrock — behavioral KPIs (tilt/momentum + climb/session).
  winrateAfterLoss?:   RateSample
  winrateAfterWin?:    RateSample
  firstGameWinrate?:   RateSample
  netRankWeek?:        { netPercent: number; readCount: number; totalCount: number }
  avgGameLength?:      number | null
  leaverStats?:        LeaverRate
  sessions?:           number
  tiltQueues?:         TiltEpisodes
  sessionDepth?:       SessionIndexBreakdown
  // Query helpers — climb-form widgets.
  formDelta?:          FormDelta
  lossStreakRecovery?: RateSample
  // Query helpers — baseline / climb widgets. Each reports null rather than
  // zero when nothing was read, so a test that omits these gets the
  // honest-empty branch, not a fake stalled climb.
  rollingBaseline?:     BaselineDelta
  perfVsRank?:          PerformanceVsRank
  velocity?:            ClimbVelocity
  // Query helper — loss quality (takes no opts; wrapQuery tolerates that).
  lossQualityBreakdown?: { rows: BreakdownEntry[]; unscored: number }
  // Query helpers — the SR-denominated climb widgets and the queue gap.
  srClimbRate?: SRVelocity
  srByHero?: SRHeroRow[]
  queueGapSplit?: QueueGapSplit
  heroConcentration?: HeroConcentration
}

function fakeDossier(over: DossierOverride): MatchesDossier {
  const wrap = <T>(v: T | undefined, fallback: T): ComputedRef<T> =>
    computed(() => (v === undefined ? fallback : v))
  const wrapQuery = <T, Opts>(v: T | undefined, fallback: T): (opts?: Opts) => ComputedRef<T> =>
    () => computed(() => (v === undefined ? fallback : v))

  return {
    records:             wrap(over.records, []),
    // Bedrock
    wld:                 wrap(over.wld, { w: 0, l: 0, d: 0, total: 0 }),
    winrate:             wrap(over.winrate, null),
    totalTimePlayed:     wrap(over.totalTimePlayed, { minutes: 0, label: '—', recordsWithTime: 0, recordsTotal: 0 }),
    averageKDA:          wrap(over.averageKDA, null),
    reviewedCount:       wrap(over.reviewedCount, { reviewed: 0, total: 0, percent: 0 }),
    daysSinceLastReview: wrap(over.daysSinceLastReview, { days: null, lastReviewedAt: null }),
    wldSinceLastReview:  wrap(over.wldSinceLastReview, null),
    currentStreak:       wrap(over.currentStreak, { count: 0, result: null, sinceDate: null }),
    longestWinStreak:    wrap(over.longestWinStreak, 0),
    topRoles:            wrap(over.topRoles, []),
    playModeBreakdown:   wrap(over.playModeBreakdown, [] as BreakdownEntry[]),
    // Query helpers — return functions matching the dossier's signature.
    topByCount:          wrapQuery(over.topByCount, [] as BreakdownEntry[]),
    winrateBy:           wrapQuery(over.winrateBy, [] as BreakdownEntry[]),
    heroCountBuckets:    wrapQuery(over.heroCountBuckets, [] as HeroCountBucket[]),
    heroPool:            wrapQuery(over.heroPool, EMPTY_POOL),
    modifierBreakdown:   wrapQuery(over.modifierBreakdown, [] as BreakdownEntry[]),
    modifierRecord:      wrapQuery(over.modifierRecord, null as ModifierRecord | null),
    currentRank:         wrap(over.currentRank, [] as RankNow[]),
    winrateAfterLoss:    wrap(over.winrateAfterLoss, { winrate: null, sample: 0 } as RateSample),
    winrateAfterWin:     wrap(over.winrateAfterWin, { winrate: null, sample: 0 } as RateSample),
    firstGameWinrate:    wrap(over.firstGameWinrate, { winrate: null, sample: 0 } as RateSample),
    netRankWeek:         wrap(over.netRankWeek, { netPercent: 0, readCount: 0, totalCount: 0 }),
    avgGameLength:       wrap(over.avgGameLength, null as number | null),
    leaverStats:         wrap(over.leaverStats, { rate: null, leaverCount: 0, total: 0 } as LeaverRate),
    sessions:            wrap(over.sessions, 0),
    tiltQueues:          wrap(over.tiltQueues, { episodes: 0, tiltGames: 0, tiltWins: 0 } as TiltEpisodes),
    sessionDepth:        wrap(over.sessionDepth, { buckets: [], slope: null, sessions: 0 } as SessionIndexBreakdown),
    formDelta:           wrapQuery(over.formDelta, {
      recent:   { winrate: null, sample: 0 },
      overall:  { winrate: null, sample: 0 },
      deltaPts: null,
    } as FormDelta),
    lossStreakRecovery:  wrapQuery(over.lossStreakRecovery, { winrate: null, sample: 0 } as RateSample),
    rollingBaseline:     wrapQuery(over.rollingBaseline, EMPTY_BASELINE),
    perfVsRank:          wrapQuery(over.perfVsRank, {
      delta: EMPTY_BASELINE, netPercent: null, readCount: 0, readOf: 0, verdict: 'unknown',
    } as PerformanceVsRank),
    velocity:            wrapQuery(over.velocity, {
      perSession: null, perWeek: null, sessions: 0, readCount: 0,
    } as ClimbVelocity),
    srClimbRate: wrapQuery(over.srClimbRate, {
      perWeek: null, perSession: null, sessions: 0, readCount: 0,
    } as SRVelocity),
    srByHero:    wrapQuery(over.srByHero, [] as SRHeroRow[]),
    queueGapSplit: wrapQuery(over.queueGapSplit, {
      tilted: { winrate: null, sample: 0 }, fresh: { winrate: null, sample: 0 },
    } as QueueGapSplit),
    heroConcentration: wrapQuery(over.heroConcentration, {
      score: null, effectiveHeroes: 0, overReliance: '', heroes: 0,
    } as HeroConcentration),
    lossQualityBreakdown: wrapQuery(over.lossQualityBreakdown, {
      // The real helper maps a fixed ['close','normal','stomp'] tuple, so it
      // ALWAYS returns three rows. An empty array is a shape production
      // cannot produce, and a fake that invents one buys false coverage.
      rows: (['close', 'normal', 'stomp'] as const).map((key) => ({ key, total: 0, winrate: 0, share: 0 })),
      unscored: 0,
    }),
    withWhomBreakdown:   wrapQuery(over.withWhomBreakdown, [] as BreakdownEntry[]),
    topHeroesByMinutes:  wrapQuery(over.topHeroesByMinutes, [] as HeroBreakdownEntry[]),
    mostPlayedHero:      wrapQuery(over.mostPlayedHero, null),
    bestWinrateHero:     wrapQuery(over.bestWinrateHero, null),
    timeOfDayBuckets:    wrapQuery(over.timeOfDayBuckets, [] as BucketEntry[]),
    dayOfWeekBuckets:    wrapQuery(over.dayOfWeekBuckets, [] as BucketEntry[]),
    recentResults:       wrapQuery(over.recentResults, [] as ('victory' | 'defeat' | 'draw')[]),
    heroGameModeCounts:   wrapQuery(over.heroGameModeCounts, []),
    mapRoleCounts:       wrapQuery(over.mapRoleCounts, [] as MapRoleCell[]),
    mapCounts:           wrapQuery(over.mapCounts, []),
    recentMatches:       wrapQuery(over.recentMatches, []),
  } as unknown as MatchesDossier
}

export interface RenderWidgetOptions {
  // Subset of the dossier to expose to the widget. Fields the widget
  // doesn't read can be omitted.
  dossier?: DossierOverride
  // Optional UNFILTERED dossier (FULL_DOSSIER_KEY). Widgets that size their
  // structure off useFullDossier() read it; omit and useFullDossier() falls back
  // to the narrowed `dossier` above (so most widget tests need only `dossier`).
  fullDossier?: DossierOverride
  // Optional config seed for widgets that read useWidgetConfig. Keyed
  // on widget id; localStorage is stubbed fresh per render so the seed
  // hydrates cleanly.
  configSeed?: Record<string, Record<string, unknown>>
  // Optional narrow stub for widgets that need to call into the
  // active-filter handlers (heatmap cell clicks → pickHero +
  // pickGameMode). Tests pass plain spies — the helper wraps them
  // in a minimal NarrowApi shape so useNarrow() resolves.
  narrow?: Partial<NarrowApi>
}

// Renders the widget with a provided mock dossier + optional config
// seed. Widget tests only need `dossier.<field>` overrides for the
// fields the widget reads — others fall back to safe stubs.
export function renderWidget(
  Component: Component,
  options: RenderWidgetOptions = {},
): RenderResult {
  installMemoryLocalStorage()
  if (options.configSeed) {
    for (const [id, value] of Object.entries(options.configSeed)) {
      localStorage.setItem(`recall.dashboard.widget-config.${id}`, JSON.stringify(value))
    }
  }
  const dossier = fakeDossier(options.dossier ?? {})
  // Falls back to the narrowed dossier when no full one is given — matching
  // useFullDossier()'s own production fallback.
  const fullDossier = options.fullDossier ? fakeDossier(options.fullDossier) : dossier
  const narrow = options.narrow ?? {}
  // Cast the component reference through `unknown` because render's
  // typed overloads can't see the SFC instance type without an
  // import-from-vue inference that the test-utils call site never
  // needs. The runtime path is unaffected.
  return render(Component as unknown as Parameters<typeof render>[0], {
    global: {
      provide: {
        [DOSSIER_KEY as symbol]:      dossier,
        [FULL_DOSSIER_KEY as symbol]: fullDossier,
        [NARROW_KEY  as symbol]:      narrow,
      },
    },
  })
}

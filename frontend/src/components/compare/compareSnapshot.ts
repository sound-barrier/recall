import type { MatchRecord } from '@/api-client'
import type { MatchesDossier } from '@/composables/matches/dossier/useMatchesDossier'
import type { BreakdownEntry } from '@/composables/matches/dossier/useMatchesDossier.types'
import {
  bestHeroByRole, heroPoolsByRole, modeBreakdown, playlistCounts, queueCounts,
  roleRates, topMap, worstHero,
} from '@/match/compare/match-compare-aggregate'
import {
  analyzeHeroPool, heroCountBuckets, DEFAULT_HERO_MEANINGFUL_PCT,
  type HeroCountBucket,
} from '@/match/dossier/match-hero-pool-helpers'
import type { RateStat, SeasonMetrics } from '@/match/compare/match-compare-helpers'
import { matchTime } from '@/match/match-time-helpers'
import { roleBucket } from '@/match/trends/match-trends-helpers'

// Shared SeasonMetrics assembly for both Compare modes: the scalar metrics come
// off a dossier instance, the compare-specific breakdowns off the record slice.
// The Form mode passes `extras` (rank/sessions/leaver) to light up its extra
// rows; the Seasons mode omits them and stays visually unchanged.

// A hero qualifies as best/worst for a window only with at least this many
// decisive games, so a 1-game 100% hero can't take the title — matches the
// win-rate low-sample floor (LOW_SAMPLE_N).
const HERO_MIN_GAMES = 5

export interface SnapshotResolvers {
  heroRole: (input: string | null | undefined) => string
  heroDisplayName: (input: string | null | undefined) => string
  mapDisplayName: (input: string | null | undefined) => string
  mapGameMode: (input: string | null | undefined) => string
}

interface SnapshotExtras {
  rankProgress: number | null
  sessions: number
  leaverRatePct: number | null
}

export function topHeroDisplay(entries: BreakdownEntry[], resolvers: Pick<SnapshotResolvers, 'heroDisplayName'>): string | null {
  const top = entries[0]
  return top ? resolvers.heroDisplayName(top.key) : null
}

// Fold hero-count buckets into one RateStat: total games across the picked
// buckets, winrate over their combined decisive games.
function foldBuckets(buckets: HeroCountBucket[], pick: (b: HeroCountBucket) => boolean): RateStat {
  let games = 0
  let wins = 0
  let decisive = 0
  for (const b of buckets) {
    if (!pick(b)) continue
    games += b.total
    wins += b.wins
    decisive += b.decisive
  }
  return { games, decisive, winrate: decisive === 0 ? 0 : Math.round((wins / decisive) * 100) }
}

// Per-window inputs the snapshot can't derive from the dossier/records
// alone: the resolved top-hero label, the name resolvers, and the Form
// mode's optional extras.
export interface SnapshotInputs {
  topHero: string | null
  ow: SnapshotResolvers
  extras?: SnapshotExtras
}

// latestRankPercentile is the slice's ENDING standing in the population.
//
// It is scoped to a single rank TRACK, and that is the whole difficulty.
// Overwatch keeps a separate rank per role in role queue, so a slice usually
// contains readings from several ladders; taking "the newest reading" across
// all of them compares a Support standing in one window against a Tank
// standing in the other. That is not a smaller version of the same number, it
// is a different measurement — the dossier widget refuses to collapse them for
// exactly this reason, and so does currentRankByRole.
//
// So: pick the role bucket with the most rank readings in the slice (the one
// the player actually played), and report that bucket's latest reading. If the
// two slices end up on different buckets the comparison is still apples to
// oranges, so the caller is told WHICH bucket and drops the row when they
// disagree.
//
// Selection is by match time rather than array position: the slices are
// filtered copies whose order is not part of any contract, and depending on it
// would silently yield the OLDEST reading — 57% against 61% is a difference
// nothing downstream could flag as wrong.
// Local to this module: SeasonMetrics declares the shape it stores, and
// exporting a second name for it made a type nothing imported.
interface SliceStanding {
  bucket: string
  percentile: number
}

function latestRankStanding(records: readonly MatchRecord[]): SliceStanding | null {
  const byBucket = new Map<string, { pct: number; at: string; n: number }>()
  for (const r of records) {
    const pct = r.data?.rank_percentile
    if (typeof pct !== 'number') continue
    const key = roleBucket(r).key
    const at = matchTime(r)
    const prev = byBucket.get(key)
    if (!prev) {
      byBucket.set(key, { pct, at, n: 1 })
      continue
    }
    prev.n++
    if (at > prev.at) {
      prev.pct = pct
      prev.at = at
    }
  }
  let best: SliceStanding | null = null
  let bestN = 0
  for (const [bucket, v] of byBucket) {
    if (v.n > bestN) {
      best = { bucket, percentile: v.pct }
      bestN = v.n
    }
  }
  return best
}

export function buildSeasonMetrics(
  d: MatchesDossier,
  records: MatchRecord[],
  inputs: SnapshotInputs,
): SeasonMetrics {
  const { topHero, ow, extras } = inputs
  const wld = d.wld.value
  const kda = d.averageKDA.value
  const time = d.totalTimePlayed.value
  // Role rows use rolesForHeader (via roleRates) rather than the dossier's
  // topRoles union, so they name the same record set the narrow's role filter
  // (and the leaf-row role chips) select — a role drill-through is exact.
  const roles = roleRates(records, ow.heroRole)
  const pools = heroPoolsByRole(records, ow.heroRole)
  const best = bestHeroByRole(records, ow.heroRole, ow.heroDisplayName, HERO_MIN_GAMES)
  const playlists = playlistCounts(records)
  const queues = queueCounts(records)
  // Hero-swap discipline at the fixed default threshold — Compare has no
  // per-widget gear, so it always reads the 5% "touched the point" floor.
  const buckets = heroCountBuckets(records, DEFAULT_HERO_MEANINGFUL_PCT)
  const poolAnalysis = analyzeHeroPool(records, DEFAULT_HERO_MEANINGFUL_PCT, ow.heroRole)
  return {
    games: wld.total, wins: wld.w, losses: wld.l, draws: wld.d,
    competitiveGames: playlists.competitive, quickPlayGames: playlists.quickplay,
    roleQueueGames: queues.role, openQueueGames: queues.open,
    winratePct: d.winrate.value,
    elimsPer10: kda ? kda.eliminations : null,
    deathsPer10: kda ? kda.deaths : null,
    assistsPer10: kda ? kda.assists : null,
    minutesPlayed: time.minutes, timeLabel: time.label,
    combatSamples: kda?.qualifyingMatches ?? 0,
    longestWinStreak: d.longestWinStreak.value,
    longestLosingStreak: d.longestLosingStreak.value,
    roleTank: roles.tank, roleDps: roles.dps, roleSupport: roles.support,
    heroPoolTank: pools.tank, heroPoolDps: pools.dps, heroPoolSupport: pools.support,
    bestHeroTank: best.tank, bestHeroDps: best.dps, bestHeroSupport: best.support,
    topMap: topMap(records, ow.mapDisplayName),
    modes: modeBreakdown(records, ow.mapGameMode),
    topHero,
    worstHero: worstHero(records, ow.heroDisplayName, HERO_MIN_GAMES),
    heroPool: poolAnalysis.pool.length > 0
      ? poolAnalysis.pool.map((p) => ow.heroDisplayName(p.key)).join(', ')
      : null,
    singleHeroGames: foldBuckets(buckets, (b) => b.heroes === 1),
    multiHeroGames: foldBuckets(buckets, (b) => b.heroes >= 2),
    pureHeroPoolGames: {
      games: poolAnalysis.split.pure.games,
      decisive: poolAnalysis.split.pure.decisive,
      winrate: poolAnalysis.split.pure.winrate,
    },
    outOfPoolGames: {
      games: poolAnalysis.split.out.games,
      decisive: poolAnalysis.split.out.decisive,
      winrate: poolAnalysis.split.out.winrate,
    },
    // Computed here, not passed as a Form-mode extra, so BOTH compare modes
    // get it — the question "did my standing in the population move?" is at
    // least as interesting across two seasons as across two weeks.
    rankStanding: latestRankStanding(records),
    ...(extras ?? {}),
  }
}

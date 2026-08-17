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
    ...(extras ?? {}),
  }
}

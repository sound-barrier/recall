import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import type { MatchRecord } from '@/api'
import { useMatchesDossier } from '@/composables/matches/dossier/useMatchesDossier'
import type { BreakdownEntry } from '@/composables/matches/dossier/useMatchesDossier.types'
import { buildSeasonMetrics, topHeroDisplay, type SnapshotResolvers } from '@/components/compare/compareSnapshot'

// buildSeasonMetrics is the one snapshot assembler both Compare modes share:
// scalars off a dossier instance, compare-only breakdowns off the record slice.
// The contracts worth pinning are the ones a Seasons/Form divergence would
// break — the optional `extras` block, the best/worst-hero sample floor, and
// the bucket folds' behavior on a window with no decisive games.

type MatchData = NonNullable<MatchRecord['data']>

const ROLES: Record<string, NonNullable<MatchData['role']>> = { lucio: 'support', ana: 'support', genji: 'dps', reinhardt: 'tank' }
const HERO_NAMES: Record<string, string> = { lucio: 'Lúcio', ana: 'Ana', genji: 'Genji', reinhardt: 'Reinhardt' }

const resolvers: SnapshotResolvers = {
  heroRole: (h) => (h ? ROLES[h] ?? '' : ''),
  heroDisplayName: (h) => (h ? HERO_NAMES[h] ?? h : ''),
  mapDisplayName: (m) => (m ? m.charAt(0).toUpperCase() + m.slice(1) : ''),
  mapGameMode: (m) => (m === 'rialto' ? 'escort' : 'control'),
}

interface RecOpts {
  hero?: string
  result?: 'victory' | 'defeat' | 'draw'
  heroes?: { hero: string; percent_played?: number }[]
  date?: string
  playlist?: MatchData['playlist']
  per10?: { elims: number; deaths: number; assists: number }
}

// Only a record carrying ALL THREE per-10 rates contributes to averageKDA —
// the dossier refuses to average a partial block against zero.
function performance(per10: NonNullable<RecOpts['per10']>) {
  return {
    eliminations: { total: 10, avg_per_10min: per10.elims },
    deaths: { total: 3, avg_per_10min: per10.deaths },
    assists: { total: 5, avg_per_10min: per10.assists },
  }
}

let seq = 0

function record(opts: RecOpts = {}): MatchRecord {
  seq++
  const date = opts.date ?? `2026-05-${String((seq % 28) + 1).padStart(2, '0')}`
  const hero = opts.hero ?? 'lucio'
  return {
    match_key: `match-${date}T1${seq % 10}-00-00`,
    source_files: [`${seq}.png`],
    data: {
      map: 'rialto',
      game_mode: 'escort',
      playlist: opts.playlist ?? 'competitive',
      role: ROLES[hero] ?? 'support',
      hero,
      result: opts.result ?? 'victory',
      date,
      finished_at: `1${seq % 10}:00`,
      heroes_played: opts.heroes ?? [{ hero, percent_played: 100 }],
      performance: opts.per10 ? performance(opts.per10) : undefined,
    },
    parsed_at: `${date}T23:00:00Z`,
  }
}

function snapshotOf(records: MatchRecord[], extras?: Parameters<typeof buildSeasonMetrics>[2]['extras']) {
  const dossier = useMatchesDossier(ref(records), ref('include'), resolvers.heroRole, ref(1))
  return buildSeasonMetrics(dossier, records, { topHero: null, ow: resolvers, extras })
}

describe('topHeroDisplay', () => {
  it('resolves the leading breakdown entry and reports null for an empty breakdown', () => {
    const entries: BreakdownEntry[] = [
      { key: 'lucio', total: 4, winrate: 75, share: 80 },
      { key: 'genji', total: 1, winrate: 0, share: 20 },
    ]
    expect(topHeroDisplay(entries, resolvers)).toBe('Lúcio')
    expect(topHeroDisplay([], resolvers)).toBeNull()
  })
})

describe('buildSeasonMetrics', () => {
  it('omits the Form-only extras entirely when none are supplied', () => {
    const metrics = snapshotOf([record()])
    // compareSeasons emits the rank/sessions/leaver rows only when BOTH
    // snapshots carry the field — `undefined` is not good enough, the key must
    // be absent so the Seasons mode's table stays unchanged.
    expect('rankProgress' in metrics).toBe(false)
    expect('sessions' in metrics).toBe(false)
    expect('leaverRatePct' in metrics).toBe(false)
  })

  it('carries the Form extras through verbatim when supplied', () => {
    const metrics = snapshotOf([record()], { rankProgress: 1.4, sessions: 3, leaverRatePct: 0 })
    expect(metrics.rankProgress).toBe(1.4)
    expect(metrics.sessions).toBe(3)
    expect(metrics.leaverRatePct).toBe(0)
  })

  it('withholds the best/worst-hero titles until a hero has five decisive games', () => {
    const four = Array.from({ length: 4 }, () => record({ hero: 'genji', result: 'victory' }))
    expect(snapshotOf(four).bestHeroDps).toBeNull()
    expect(snapshotOf(four).worstHero).toBeNull()

    const five = Array.from({ length: 5 }, () => record({ hero: 'genji', result: 'victory' }))
    expect(snapshotOf(five).bestHeroDps).toEqual({ hero: 'Genji', winrate: 100, games: 5 })
    expect(snapshotOf(five).worstHero).toEqual({ hero: 'Genji', winrate: 100, games: 5 })
  })

  it('folds hero-count buckets into a single-hero and a multi-hero rate', () => {
    const metrics = snapshotOf([
      record({ hero: 'lucio', result: 'victory' }),
      record({ hero: 'lucio', result: 'defeat' }),
      record({
        hero: 'lucio',
        result: 'victory',
        heroes: [{ hero: 'lucio', percent_played: 60 }, { hero: 'ana', percent_played: 40 }],
      }),
      record({
        hero: 'lucio',
        result: 'victory',
        heroes: [
          { hero: 'lucio', percent_played: 40 },
          { hero: 'ana', percent_played: 40 },
          { hero: 'genji', percent_played: 20 },
        ],
      }),
    ])
    expect(metrics.singleHeroGames).toEqual({ games: 2, decisive: 2, winrate: 50 })
    // The 2-hero and 3-hero buckets fold together into one multi-hero rate.
    expect(metrics.multiHeroGames).toEqual({ games: 2, decisive: 2, winrate: 100 })
  })

  it('reports 0% rather than NaN for a window whose games were all draws', () => {
    const draws = [record({ result: 'draw' }), record({ result: 'draw' })]
    const metrics = snapshotOf(draws)
    expect(metrics.games).toBe(2)
    expect(metrics.wins).toBe(0)
    expect(metrics.losses).toBe(0)
    expect(metrics.draws).toBe(2)
    expect(metrics.winratePct).toBeNull()
    expect(metrics.singleHeroGames).toEqual({ games: 2, decisive: 0, winrate: 0 })
    expect(metrics.multiHeroGames).toEqual({ games: 0, decisive: 0, winrate: 0 })
  })

  it('renders an empty window as a zeroed snapshot with no hero pool', () => {
    const metrics = snapshotOf([])
    expect(metrics.games).toBe(0)
    expect(metrics.winratePct).toBeNull()
    expect(metrics.topMap).toBeNull()
    expect(metrics.heroPool).toBeNull()
    expect(metrics.modes).toEqual([])
    expect(metrics.roleSupport).toEqual({ winrate: 0, games: 0 })
    expect(metrics.pureHeroPoolGames.games).toBe(0)
  })

  it('names the hero pool with display names and splits in-pool from out-of-pool games', () => {
    const records = [
      ...Array.from({ length: 6 }, () => record({ hero: 'lucio', result: 'victory' })),
      record({ hero: 'genji', result: 'defeat' }),
    ]
    const metrics = snapshotOf(records)
    expect(metrics.heroPool).toContain('Lúcio')
    expect(metrics.pureHeroPoolGames.games + metrics.outOfPoolGames.games).toBe(7)
    expect(metrics.outOfPoolGames.games).toBeGreaterThan(0)
  })

  it('carries the combat rates and their real denominator off the dossier', () => {
    const metrics = snapshotOf([
      record({ per10: { elims: 20, deaths: 6, assists: 10 } }),
      record({ per10: { elims: 10, deaths: 4, assists: 6 } }),
      record(), // no performance block — must not pull the averages toward zero
    ])
    expect(metrics.elimsPer10).toBe(15)
    expect(metrics.deathsPer10).toBe(5)
    expect(metrics.assistsPer10).toBe(8)
    // combatSamples is the rates' honest denominator — the verdict gates its
    // combat movers on it, so it counts only performance-bearing games.
    expect(metrics.combatSamples).toBe(2)
  })

  it('counts playlists and queues off the record slice, not the dossier', () => {
    const metrics = snapshotOf([
      record({ playlist: 'competitive' }),
      record({ playlist: 'competitive' }),
      record({ playlist: 'quickplay' }),
    ])
    expect(metrics.competitiveGames).toBe(2)
    expect(metrics.quickPlayGames).toBe(1)
  })
})

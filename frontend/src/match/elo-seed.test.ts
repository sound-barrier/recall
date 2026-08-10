import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import {
  isCompetitive, trackRecords, seedTrack, availableTracks, heroPickerStats, pooledWinLoss,
  pooledDecisiveMatches, measuredDecaySlope,
} from '@/match/elo-seed'
import { DEFAULT_METER_MOVE_PCT } from '@/match/elo-model'

type Rec = Pick<MatchRecord, 'match_key' | 'data' | 'queue_type' | 'play_mode'>

let seq = 0
interface RecOpts {
  result?: string
  hero?: string
  role?: string
  queue?: 'role' | 'open'
  playMode?: 'competitive' | 'quickplay'
  playlist?: string
  daysAgo?: number
  rank?: { tier: string; level: number; progress: number; change?: number; modifiers?: string[] }
}

function rec(opts: RecOpts = {}): Rec {
  seq++
  const days = opts.daysAgo ?? Math.ceil(seq / 5)
  const d = new Date(Date.UTC(2026, 5, 30, 12, 0, 0) - days * 86_400_000 - seq * 60_000)
  const iso = d.toISOString()
  return {
    match_key: `m${seq}`,
    queue_type: opts.queue ?? 'role',
    play_mode: opts.playMode,
    data: {
      map: 'ilios',
      playlist: opts.playlist ?? 'competitive',
      hero: opts.hero ?? 'lucio',
      role: opts.role ?? 'support',
      result: opts.result ?? 'victory',
      date: iso.slice(0, 10),
      finished_at: iso.slice(11, 16),
      played_at_utc: iso,
      heroes_played: [{ hero: opts.hero ?? 'lucio', percent_played: 100 }],
      ...(opts.rank
        ? {
            rank: opts.rank.tier,
            level: opts.rank.level,
            rank_progress: opts.rank.progress,
            ...(opts.rank.change !== undefined ? { change_percent: opts.rank.change } : {}),
            ...(opts.rank.modifiers ? { modifiers: opts.rank.modifiers } : {}),
          }
        : {}),
    },
  } as unknown as Rec
}

describe('isCompetitive', () => {
  it('honors the play-mode override over the OCR playlist', () => {
    expect(isCompetitive(rec({ playMode: 'competitive', playlist: 'quickplay' }))).toBe(true)
    expect(isCompetitive(rec({ playMode: 'quickplay', playlist: 'competitive' }))).toBe(false)
    expect(isCompetitive(rec({ playlist: 'quickplay' }))).toBe(false)
  })

  it('a rank reading is definitionally competitive', () => {
    const r = rec({ playlist: '', rank: { tier: 'gold', level: 2, progress: 40 } })
    expect(isCompetitive(r)).toBe(true)
  })
})

describe('trackRecords', () => {
  it('splits role queue by role and open queue into its own track', () => {
    seq = 0
    const records = [
      rec({ role: 'support' }),
      rec({ role: 'dps', hero: 'ashe' }),
      rec({ queue: 'open', role: 'tank', hero: 'zarya' }),
      rec({ playlist: 'quickplay' }), // not competitive → dropped
    ]
    expect(trackRecords(records, 'support')).toHaveLength(1)
    expect(trackRecords(records, 'dps')).toHaveLength(1)
    expect(trackRecords(records, 'open')).toHaveLength(1)
    expect(trackRecords(records, 'tank')).toHaveLength(0)
  })
})

describe('seedTrack', () => {
  it('seeds rank, record, meter move, and pace from the track history', () => {
    seq = 0
    const records = [
      // Latest reading wins the "current rank" slot.
      rec({ daysAgo: 1, result: 'victory', rank: { tier: 'gold', level: 2, progress: 40, change: 22 } }),
      rec({ daysAgo: 2, result: 'defeat', rank: { tier: 'gold', level: 2, progress: 18, change: -20 } }),
      rec({ daysAgo: 3, result: 'victory', rank: { tier: 'gold', level: 3, progress: 95, change: 21 } }),
      // Calibration + zero readings are excluded from the meter mean.
      rec({ daysAgo: 4, result: 'victory', rank: { tier: 'gold', level: 3, progress: 70, change: 35, modifiers: ['victory', 'calibration'] } }),
      rec({ daysAgo: 5, result: 'victory', rank: { tier: 'gold', level: 3, progress: 40, change: 0 } }),
      ...Array.from({ length: 9 }, (_, i) => rec({ daysAgo: 6 + (i % 3), result: i < 6 ? 'victory' : 'defeat' })),
    ]
    const seed = seedTrack(records, 'support')
    expect(seed.rank?.tier).toBe('gold')
    expect(seed.rank?.level).toBe(2)
    expect(seed.rank?.progress).toBe(40)
    expect(seed.currentScore).toBeCloseTo(13.4, 9)
    expect(seed.wins).toBe(10)
    expect(seed.losses).toBe(4)
    expect(seed.winRate).toBeCloseTo(10 / 14, 9)
    expect(seed.meterMovePct).toBeCloseTo(21, 9) // mean(22, 20, 21)
    expect(seed.meterSampleN).toBe(3)
    // All 14 decisive games within 28 days, history span < 28d → real span (≥7d).
    expect(seed.gamesPerWeek).not.toBeNull()
    expect(seed.gamesPerWeek!).toBeGreaterThan(5)
  })

  it('falls back to the default meter move under three qualifying samples', () => {
    seq = 0
    const records = [
      rec({ rank: { tier: 'silver', level: 1, progress: 10, change: 24 } }),
      rec({ rank: { tier: 'silver', level: 1, progress: 34, change: 0 } }),
    ]
    const seed = seedTrack(records, 'support')
    expect(seed.meterMovePct).toBe(DEFAULT_METER_MOVE_PCT)
    expect(seed.meterSampleN).toBe(1)
  })

  it('yields nulls on an empty track', () => {
    const seed = seedTrack([], 'tank')
    expect(seed.rank).toBeNull()
    expect(seed.currentScore).toBeNull()
    expect(seed.winRate).toBeNull()
    expect(seed.gamesPerWeek).toBeNull()
  })
})

describe('availableTracks', () => {
  it('summarizes per-track data and defaults to the most-played ranked track', () => {
    seq = 0
    const records = [
      // DPS: most games but NO rank reading.
      ...Array.from({ length: 8 }, () => rec({ role: 'dps', hero: 'ashe' })),
      // Support: fewer games, has a rank → wins the default.
      ...Array.from({ length: 4 }, () => rec({ role: 'support' })),
      rec({ role: 'support', rank: { tier: 'gold', level: 2, progress: 40 } }),
    ]
    const { tracks, defaultTrack } = availableTracks(records)
    expect(defaultTrack).toBe('support')
    const dps = tracks.find((t) => t.key === 'dps')!
    expect(dps.hasRank).toBe(false)
    expect(dps.decisiveN).toBe(8)
  })

  it('falls back to the most-played track when nothing has a rank', () => {
    seq = 0
    const records = Array.from({ length: 3 }, () => rec({ role: 'tank', hero: 'zarya' }))
    expect(availableTracks(records).defaultTrack).toBe('tank')
  })
})

describe('heroPickerStats / pooledWinLoss', () => {
  it('lists heroes with records, Wilson margins, and pool badges (in-pool first)', () => {
    seq = 0
    const records = [
      ...Array.from({ length: 8 }, (_, i) => rec({ hero: 'lucio', result: i < 6 ? 'victory' : 'defeat' })),
      ...Array.from({ length: 3 }, (_, i) => rec({ hero: 'ana', result: i < 1 ? 'victory' : 'defeat' })),
    ]
    const stats = heroPickerStats(records, () => 'support')
    expect(stats[0]!.key).toBe('lucio')
    expect(stats[0]!.inPool).toBe(true)
    expect(stats[0]!.wins).toBe(6)
    expect(stats[0]!.losses).toBe(2)
    expect(stats[0]!.marginPts).not.toBeNull()
    const ana = stats.find((s) => s.key === 'ana')!
    expect(ana.inPool).toBe(false) // 3 games < the 5-decisive pool floor
    expect(ana.lowSample).toBe(true)

    expect(pooledWinLoss(stats, new Set(['lucio']))).toEqual({ wins: 6, losses: 2 })
    expect(pooledWinLoss(stats, new Set(['lucio', 'ana']))).toEqual({ wins: 7, losses: 4 })
    expect(pooledWinLoss(stats, new Set())).toEqual({ wins: 0, losses: 0 })
  })
})

describe('measuredDecaySlope', () => {
  // Two rank bands with a falling win rate: 30 games at Gold 5 (ladder 10,
  // 21W/9L) then 30 at Gold 2 (ladder 13, 18W/12L). The carry-forward
  // pairing yields 59 (pre-match score, result) points across 3 divisions.
  function climbCorpus(): Rec[] {
    seq = 0
    const rows: Rec[] = []
    for (let i = 0; i < 30; i++) {
      rows.push(rec({
        daysAgo: 90 - i, result: i % 10 < 7 ? 'victory' : 'defeat',
        rank: { tier: 'gold', level: 5, progress: 0, change: i % 2 ? 20 : -20 },
      }))
    }
    for (let i = 0; i < 30; i++) {
      rows.push(rec({
        daysAgo: 40 - i, result: i % 10 < 6 ? 'victory' : 'defeat',
        rank: { tier: 'gold', level: 2, progress: 0, change: i % 2 ? 20 : -20 },
      }))
    }
    return rows
  }

  it('recovers a positive slope with a CI from a two-band climb', () => {
    const m = measuredDecaySlope(climbCorpus())!
    expect(m).not.toBeNull()
    expect(m.n).toBe(59)
    // Analytic two-cluster estimate ≈ 3.3 pts/division; allow fit slack.
    expect(m.pts).toBeGreaterThan(1.5)
    expect(m.pts).toBeLessThan(6)
    expect(m.lowerPts).toBeLessThan(m.pts)
    expect(m.upperPts).toBeGreaterThan(m.pts)
  })

  it('is null with too few rank-bearing games or no rank spread', () => {
    expect(measuredDecaySlope(climbCorpus().slice(0, 25))).toBeNull()
    seq = 0
    const flat = Array.from({ length: 60 }, (_, i) => rec({
      daysAgo: 90 - i, result: i % 2 ? 'victory' : 'defeat',
      rank: { tier: 'gold', level: 3, progress: 0 },
    }))
    expect(measuredDecaySlope(flat)).toBeNull()
  })

  it('plumbs through seedTrack as decaySlope', () => {
    expect(seedTrack(climbCorpus(), 'support').decaySlope).not.toBeNull()
    seq = 0
    const tiny = [rec({ rank: { tier: 'gold', level: 2, progress: 40 } })]
    expect(seedTrack(tiny, 'support').decaySlope).toBeNull()
  })
})

describe('heroPickerStats — adjusted rates', () => {
  it('shrinks each hero toward the pooled rate with strength-10 pseudo-games', () => {
    seq = 0
    const records = [
      ...Array.from({ length: 8 }, (_, i) => rec({ hero: 'lucio', result: i < 6 ? 'victory' : 'defeat' })),
      ...Array.from({ length: 3 }, (_, i) => rec({ hero: 'ana', result: i < 1 ? 'victory' : 'defeat' })),
    ]
    const stats = heroPickerStats(records, () => 'support')
    // Pool totals 7W/4L → 63.64%. ana raw 33% → (1 + 6.364)/13 = 56.6% → 57.
    expect(stats.find((s) => s.key === 'ana')!.adjustedWinrate).toBe(57)
    // lucio raw 75% → (6 + 6.364)/18 = 68.7% → 69.
    expect(stats.find((s) => s.key === 'lucio')!.adjustedWinrate).toBe(69)
  })
})

describe('pooledDecisiveMatches', () => {
  it('counts a two-hero match once where pooled credit counts it twice', () => {
    seq = 0
    const two = rec({ result: 'victory', hero: 'lucio' })
    ;(two.data as { heroes_played: unknown[] }).heroes_played = [
      { hero: 'lucio', percent_played: 60, play_time: '06:00' },
      { hero: 'ana', percent_played: 40, play_time: '04:00' },
    ]
    const solo = rec({ result: 'defeat', hero: 'ana' })
    const draw = rec({ result: 'draw', hero: 'lucio' })
    const records = [two, solo, draw] as unknown as MatchRecord[]
    const both = new Set(['lucio', 'ana'])
    expect(pooledDecisiveMatches(records, both)).toBe(2) // two + solo; draw excluded
    expect(pooledDecisiveMatches(records, new Set(['lucio']))).toBe(1)
    expect(pooledDecisiveMatches(records, new Set(['ashe']))).toBe(0)
  })
})

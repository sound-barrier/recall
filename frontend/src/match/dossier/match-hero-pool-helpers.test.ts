import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import { classifyPoolMembership, deriveHeroPool, heroConcentration, heroCountBuckets, matchesPoolMode, meaningfulHeroes, outOfPoolHeroes, poolSplit, rankPoolHeroes, roleWinrates } from '@/match/dossier/match-hero-pool-helpers'

type Rec = Pick<MatchRecord, 'data'>

function rec(result: string, heroes: [string, number | undefined][], primary?: string): Rec {
  return {
    data: {
      result,
      hero: primary ?? heroes[0]?.[0],
      heroes_played: heroes.map(([hero, pct]) => ({ hero, percent_played: pct })),
    },
  } as unknown as Rec
}

describe('meaningfulHeroes', () => {
  it('keeps heroes at/above the threshold and drops point-touches below it', () => {
    const r = rec('victory', [['lucio', 95], ['brig', 3]])
    expect(meaningfulHeroes(r, 5)).toEqual(['lucio'])
    // Exactly at the threshold counts.
    expect(meaningfulHeroes(rec('victory', [['lucio', 95], ['ana', 5]]), 5)).toEqual(['lucio', 'ana'])
  })

  it('treats a missing percent_played as unknown, not zero — roster-only heroes count', () => {
    // The parser omits percent_played for heroes known only from the PERSONAL
    // roster; unknown play share must not be filtered as "not played".
    expect(meaningfulHeroes(rec('victory', [['lucio', 90], ['ana', undefined]]), 5)).toEqual(['lucio', 'ana'])
    // A whole roster with no percentages stays a multi-hero match.
    expect(meaningfulHeroes(rec('victory', [['ana', undefined], ['sombra', undefined]]), 5)).toEqual(['ana', 'sombra'])
  })

  it('falls back to the primary hero when nothing clears the threshold', () => {
    expect(meaningfulHeroes(rec('victory', [['lucio', 2]], 'lucio'), 5)).toEqual(['lucio'])
    expect(meaningfulHeroes({ data: { result: 'victory', hero: 'ana' } } as unknown as Rec, 5)).toEqual(['ana'])
  })

  it('yields [] when no hero is known at all', () => {
    expect(meaningfulHeroes({ data: { result: 'victory' } } as unknown as Rec, 5)).toEqual([])
  })

  it('dedupes a hero swapped to twice', () => {
    expect(meaningfulHeroes(rec('victory', [['lucio', 40], ['ana', 20], ['lucio', 40]]), 5)).toEqual(['lucio', 'ana'])
  })
})

describe('heroCountBuckets', () => {
  it('buckets by meaningful count, omits empty buckets, and caps at 4+', () => {
    const records = [
      rec('victory', [['lucio', 100]]),
      rec('defeat', [['lucio', 97], ['brig', 3]]), // touch → still 1 hero
      rec('victory', [['lucio', 60], ['ana', 40]]),
      rec('defeat', [['a', 25], ['b', 25], ['c', 25], ['d', 15], ['e', 10]]), // 5 heroes → 4+
    ]
    const buckets = heroCountBuckets(records, 5)
    expect(buckets.map((b) => b.key)).toEqual(['1 hero', '2 heroes', '4+ heroes'])
    expect(buckets[0]).toMatchObject({ total: 2, wins: 1, winrate: 50, lowSample: true })
    expect(buckets[1]).toMatchObject({ total: 1, wins: 1, winrate: 100 })
  })

  it('counts draws in the total but not the winrate', () => {
    const buckets = heroCountBuckets([
      rec('victory', [['lucio', 100]]),
      rec('draw', [['lucio', 100]]),
    ], 5)
    expect(buckets[0]).toMatchObject({ total: 2, winrate: 100 })
  })

  it('excludes matches with no known hero', () => {
    expect(heroCountBuckets([{ data: { result: 'victory' } } as unknown as Rec], 5)).toEqual([])
  })
})

describe('deriveHeroPool', () => {
  it('requires LOW_SAMPLE_N meaningful decisive games, role-sorted then alphabetical', () => {
    const records = [
      ...Array.from({ length: 5 }, (_, i) => rec(i < 3 ? 'victory' : 'defeat', [['brig', 100]])),
      ...Array.from({ length: 7 }, (_, i) => rec(i < 5 ? 'victory' : 'defeat', [['lucio', 100]])),
      ...Array.from({ length: 3 }, () => rec('defeat', [['ana', 100]])), // below floor
    ]
    const pool = deriveHeroPool(records, 5)
    // No resolver -> every role is '' -> alphabetical.
    expect(pool.map((p) => p.key)).toEqual(['brig', 'lucio'])
    expect(pool[1]).toMatchObject({ total: 7, wins: 5, winrate: 71 })
  })

  it('draws do not count toward the decisive floor', () => {
    const records = [
      ...Array.from({ length: 4 }, () => rec('victory', [['lucio', 100]])),
      rec('draw', [['lucio', 100]]), // 5 games but only 4 decisive
    ]
    expect(deriveHeroPool(records, 5)).toEqual([])
  })

  it('scales the floor to 10% of decisive games on a large history', () => {
    // 100 decisive games: the floor is max(5, 10) = 10 — a 12-game main is in,
    // an 8-game dabble is not (it would have been at the flat 5-game floor).
    const records = [
      ...Array.from({ length: 80 }, (_, i) => rec(i % 2 ? 'victory' : 'defeat', [['lucio', 100]])),
      ...Array.from({ length: 12 }, (_, i) => rec(i % 2 ? 'victory' : 'defeat', [['brig', 100]])),
      ...Array.from({ length: 8 }, (_, i) => rec(i % 2 ? 'victory' : 'defeat', [['ana', 100]])),
    ]
    expect(deriveHeroPool(records, 5).map((p) => p.key)).toEqual(['brig', 'lucio'])
  })

  it('keeps the absolute 5-game floor on a small history (10% would be lower)', () => {
    // 15 decisive games: 10% = 1.5 → the floor stays 5, so a 5-game hero is in.
    const records = [
      ...Array.from({ length: 10 }, (_, i) => rec(i % 2 ? 'victory' : 'defeat', [['lucio', 100]])),
      ...Array.from({ length: 5 }, (_, i) => rec(i % 2 ? 'victory' : 'defeat', [['brig', 100]])),
    ]
    expect(deriveHeroPool(records, 5).map((p) => p.key)).toEqual(['brig', 'lucio'])
  })

  it('sorts Tank → DPS → Support when a role resolver is given', () => {
    const roles: Record<string, string> = { zarya: 'tank', ashe: 'dps', brig: 'support' }
    const heroRole = (h?: string | null) => roles[h ?? ''] ?? ''
    const records = [
      ...Array.from({ length: 5 }, (_, i) => rec(i % 2 ? 'victory' : 'defeat', [['brig', 100]])),
      ...Array.from({ length: 5 }, (_, i) => rec(i % 2 ? 'victory' : 'defeat', [['ashe', 100]])),
      ...Array.from({ length: 5 }, (_, i) => rec(i % 2 ? 'victory' : 'defeat', [['zarya', 100]])),
    ]
    const pool = deriveHeroPool(records, 5, heroRole)
    // Composition order despite identical game counts and alphabet.
    expect(pool.map((p) => `${p.role}:${p.key}`)).toEqual(['tank:zarya', 'dps:ashe', 'support:brig'])
  })
})

describe('poolSplit', () => {
  const pool = ['lucio', 'brig']

  it('classifies pure-pool vs any-meaningful-hero-outside', () => {
    const records = [
      rec('victory', [['lucio', 100]]),
      rec('victory', [['lucio', 50], ['brig', 50]]), // both in pool → pure
      rec('defeat', [['lucio', 60], ['ana', 40]]), // ana out → out
      rec('defeat', [['ana', 100]]),
      { data: { result: 'victory' } } as unknown as Rec, // no hero → neither
    ]
    const split = poolSplit(records, pool, 5)
    expect(split.pure).toEqual({ games: 2, wins: 2, decisive: 2, winrate: 100 })
    expect(split.out).toEqual({ games: 2, wins: 0, decisive: 2, winrate: 0 })
  })

  it('a sub-threshold touch of an out-of-pool hero stays pure', () => {
    const split = poolSplit([rec('victory', [['lucio', 97], ['ana', 3]])], pool, 5)
    expect(split.pure.games).toBe(1)
    expect(split.out.games).toBe(0)
  })
})

describe('outOfPoolHeroes', () => {
  it('lists out-of-pool heroes worst-first with their record', () => {
    const records = [
      rec('defeat', [['lucio', 60], ['ana', 40]]),
      rec('defeat', [['ana', 100]]),
      rec('victory', [['ana', 100]]),
      rec('victory', [['genji', 100]]),
      rec('victory', [['lucio', 100]]),
    ]
    const out = outOfPoolHeroes(records, ['lucio'], 5)
    expect(out.map((o) => o.key)).toEqual(['ana', 'genji']) // ana's Wilson floor < genji's
    expect(out[0]).toMatchObject({ total: 3, wins: 1, winrate: 33 })
    expect(out[1]).toMatchObject({ total: 1, wins: 1, winrate: 100, lowSample: true })
  })

  it('is empty when every meaningful hero is in the pool', () => {
    expect(outOfPoolHeroes([rec('victory', [['lucio', 100]])], ['lucio'], 5)).toEqual([])
  })
})

type ModeRec = Pick<MatchRecord, 'data' | 'queue_type' | 'play_mode'>
function modeRec(o: { queue?: 'role' | 'open'; mode?: string; role?: string; result?: string; hero?: string }): ModeRec {
  return {
    queue_type: o.queue,
    play_mode: o.mode,
    data: { result: o.result ?? 'victory', role: o.role, hero: o.hero ?? 'lucio',
      heroes_played: [{ hero: o.hero ?? 'lucio', percent_played: 100 }] },
  } as unknown as ModeRec
}

describe('matchesPoolMode', () => {
  it('role/open are competitive-only, keyed on queue_type', () => {
    expect(matchesPoolMode(modeRec({ queue: 'role', mode: 'competitive' }), 'role')).toBe(true)
    expect(matchesPoolMode(modeRec({ queue: 'open', mode: 'competitive' }), 'open')).toBe(true)
    expect(matchesPoolMode(modeRec({ queue: 'open', mode: 'competitive' }), 'role')).toBe(false)
    expect(matchesPoolMode(modeRec({ queue: 'role', mode: 'quickplay' }), 'role')).toBe(false) // qp role ≠ ranked role
  })

  it('quickplay matches the play mode regardless of queue', () => {
    expect(matchesPoolMode(modeRec({ queue: 'role', mode: 'quickplay' }), 'quickplay')).toBe(true)
    expect(matchesPoolMode(modeRec({ queue: 'open', mode: 'quickplay' }), 'quickplay')).toBe(true)
    expect(matchesPoolMode(modeRec({ queue: 'role', mode: 'competitive' }), 'quickplay')).toBe(false)
  })

  it('falls back to data.playlist when play_mode is unset, and drops non-competitive', () => {
    const rec = { queue_type: 'role', data: { playlist: 'competitive' } } as unknown as ModeRec
    expect(matchesPoolMode(rec, 'role')).toBe(true)
    expect(matchesPoolMode({ queue_type: 'role', data: {} } as unknown as ModeRec, 'role')).toBe(false)
  })

  it('treats an unlabeled competitive match as Role Queue (the ranked default)', () => {
    const noQueue = { play_mode: 'competitive', data: {} } as unknown as ModeRec
    expect(matchesPoolMode(noQueue, 'role')).toBe(true)
    expect(matchesPoolMode(noQueue, 'open')).toBe(false)
    expect(matchesPoolMode(noQueue, 'quickplay')).toBe(false)
  })
})

describe('classifyPoolMembership', () => {
  const pool = new Set(['reinhardt', 'lucio'])
  it('is pure when every meaningful hero is in the pool, off otherwise', () => {
    expect(classifyPoolMembership(rec('victory', [['reinhardt', 100]]), pool)).toBe('pure')
    expect(classifyPoolMembership(rec('defeat', [['ana', 100]]), pool)).toBe('off')
    expect(classifyPoolMembership(rec('victory', [['lucio', 60], ['ana', 40]]), pool)).toBe('off') // one outside
  })

  it('is none when the match has no known hero', () => {
    expect(classifyPoolMembership({ data: { result: 'victory' } } as unknown as Rec, pool)).toBe('none')
  })
})

describe('roleWinrates', () => {
  it('computes decisive win rate per locked role in team-composition order', () => {
    const recs = [
      modeRec({ role: 'support', result: 'victory' }), modeRec({ role: 'support', result: 'defeat' }),
      modeRec({ role: 'tank', result: 'victory' }), modeRec({ role: 'tank', result: 'victory' }), modeRec({ role: 'tank', result: 'defeat' }),
    ]
    const out = roleWinrates(recs)
    expect(out.map((r) => r.role)).toEqual(['tank', 'support']) // order tank→dps→support, dps absent
    expect(out.find((r) => r.role === 'tank')).toMatchObject({ games: 3, wins: 2, winrate: 67 })
    expect(out.find((r) => r.role === 'support')).toMatchObject({ winrate: 50 })
  })

  it('skips matches with no canonical role', () => {
    expect(roleWinrates([modeRec({ role: 'flex' }), modeRec({})])).toEqual([])
  })
})

describe('rankPoolHeroes', () => {
  const stat = (key: string, winrate: number, total: number, lowSample: boolean) =>
    ({ key, role: 'dps', total, wins: Math.round((total * winrate) / 100), losses: total - Math.round((total * winrate) / 100), winrate, lowSample })
  const analysis = {
    pool: [stat('cassidy', 55, 35, false), stat('ashe', 70, 20, false)],
    outHeroes: [stat('pharah', 100, 3, true), stat('sojourn', 63, 8, false)],
    split: { pure: { games: 0, wins: 0, decisive: 0, winrate: 0 }, out: { games: 0, wins: 0, decisive: 0, winrate: 0 } },
  }

  it('ranks statistically-significant heroes first, then by win rate — not raw %', () => {
    // Significant (n≥5) group by WR desc: ashe 70 (in), sojourn 63 (out), cassidy
    // 55 (in); then pharah (100% but only 3 games — noisy) last.
    expect(rankPoolHeroes(analysis).map((h) => h.key)).toEqual(['ashe', 'sojourn', 'cassidy', 'pharah'])
  })

  it('a high-win OUT-of-pool hero outranks a lower-win in-pool one (encourage playing it)', () => {
    const ranked = rankPoolHeroes(analysis)
    const sojourn = ranked.findIndex((h) => h.key === 'sojourn') // 63% out of pool
    const cassidy = ranked.findIndex((h) => h.key === 'cassidy') // 55% in pool
    expect(sojourn).toBeLessThan(cassidy)
    expect(ranked.find((h) => h.key === 'sojourn')!.inPool).toBe(false)
    expect(ranked.find((h) => h.key === 'cassidy')!.inPool).toBe(true)
  })
})

describe('heroConcentration', () => {
  it('scores a one-hero player as fully concentrated', () => {
    // Normalized HHI: 1 means everything is one pick, 0 an even spread. A
    // single hero has nowhere to spread to, so it is the top of the scale.
    expect(heroConcentration([{ key: 'ana', minutes: 600 }])).toEqual({
      score: 1, effectiveHeroes: 1, overReliance: 'ana', heroes: 1, unreadHeroes: 0,
    })
  })

  it('scores an even spread as unconcentrated', () => {
    const got = heroConcentration([
      { key: 'ana', minutes: 100 },
      { key: 'juno', minutes: 100 },
      { key: 'kiriko', minutes: 100 },
      { key: 'lucio', minutes: 100 },
    ])
    expect(got.score).toBe(0)
    expect(got.effectiveHeroes).toBe(4)
    expect(got.overReliance).toBe('')
  })

  it('weights by TIME, not by match count', () => {
    // Ten cameo appearances are not a hero pool. Minutes is the honest
    // denominator, which is why the match-counting pool helpers cannot
    // answer this.
    const got = heroConcentration([
      { key: 'ana', minutes: 900 },
      { key: 'juno', minutes: 100 },
    ])
    expect(got.score).toBeGreaterThan(0.5)
    expect(got.overReliance).toBe('ana')
  })

  it('flags over-reliance only past the threshold', () => {
    // 40% of the time on the top pick is a lead, not a dependency.
    const spread = heroConcentration([
      { key: 'ana', minutes: 40 },
      { key: 'juno', minutes: 30 },
      { key: 'kiriko', minutes: 30 },
    ])
    expect(spread.overReliance).toBe('')

    // Past half, it is the answer to "what do you play".
    const leaning = heroConcentration([
      { key: 'ana', minutes: 55 },
      { key: 'juno', minutes: 45 },
    ])
    expect(leaning.overReliance).toBe('ana')
  })

  it('says nothing at all when nothing was played', () => {
    expect(heroConcentration([])).toEqual({
      score: null, effectiveHeroes: 0, overReliance: '', heroes: 0, unreadHeroes: 0,
    })
  })

  it('counts the heroes whose time it could not read', () => {
    // A hero with no parseable play_time is in NO part of the score. The
    // number was thrown away, so "spread across three" could not tell the
    // reader it was three of eight.
    const got = heroConcentration([
      { key: 'ana', minutes: 300 },
      { key: 'lucio', minutes: 300 },
      { key: 'kiriko', minutes: 0 },
    ])
    expect(got.heroes).toBe(2)
    expect(got.unreadHeroes).toBe(1)
  })

  it('ignores heroes with no recorded time rather than dividing by them', () => {
    const got = heroConcentration([{ key: 'ana', minutes: 100 }, { key: 'ghost', minutes: 0 }])
    expect(got.heroes).toBe(1)
    expect(got.score).toBe(1)
  })
})

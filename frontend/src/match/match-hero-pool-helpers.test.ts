import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import {
  deriveHeroPool, heroCountBuckets, meaningfulHeroes, outOfPoolHeroes, poolSplit,
} from '@/match/match-hero-pool-helpers'

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
    const heroRole = (h?: string | null) =>
      h === 'zarya' ? 'tank' : h === 'ashe' ? 'dps' : h === 'brig' ? 'support' : ''
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

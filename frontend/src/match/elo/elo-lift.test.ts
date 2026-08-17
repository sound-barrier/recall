import { describe, it, expect } from 'vitest'

import { liftTable } from '@/match/elo/elo-lift'

const deps = { heroRole: () => 'support', mapGameMode: (m: string | null | undefined) => (m === 'ilios' ? 'control' : 'escort') }

// lucio-on-ilios 30 games (21W/9L) + ana-on-junkertown 20 games (6W/14L):
// baseline 27W/23L = 54%. Evening games throughout; a frequent teammate on
// the first 12 lucio games.
function corpus() {
  const rows: { match_key: string; annotation?: { members: string[] }; data: Record<string, unknown> }[] = []
  let n = 0
  const push = (hero: string, map: string, win: boolean, members?: string[]) => {
    n++
    rows.push({
      match_key: `m${n}`,
      ...(members ? { annotation: { members } } : {}),
      data: {
        result: win ? 'victory' : 'defeat', hero, map,
        date: `2026-05-${String((n % 28) + 1).padStart(2, '0')}`, finished_at: '20:00',
        heroes_played: [{ hero, percent_played: 100 }],
      },
    })
  }
  for (let i = 0; i < 30; i++) push('lucio', 'ilios', i < 21, i < 12 ? ['Buddy#123'] : undefined)
  for (let i = 0; i < 20; i++) push('ana', 'junkertown', i < 6)
  return rows as never[]
}

describe('liftTable', () => {
  it('computes exact shrunk lifts against the corpus baseline', () => {
    const rows = liftTable(corpus(), deps)
    const lucio = rows.find((r) => r.dimension === 'hero' && r.key === 'lucio')!
    const ana = rows.find((r) => r.dimension === 'hero' && r.key === 'ana')!
    // baseline 27/50 = 0.54; lucio shrunk = (21 + 10·0.54)/40 = 0.66 → ×1.2222.
    expect(lucio.lift).toBeCloseTo(0.66 / 0.54, 4)
    // ana shrunk = (6 + 5.4)/30 = 0.38 → ×0.7037.
    expect(ana.lift).toBeCloseTo(0.38 / 0.54, 4)
    expect(lucio.n).toBe(30)
    expect(ana.n).toBe(20)
    // The credible range brackets the point lift.
    expect(lucio.liftLo).toBeLessThan(lucio.lift)
    expect(lucio.liftHi).toBeGreaterThan(lucio.lift)
  })

  it('covers maps, modes, and teammates; drops sub-minN and whole-corpus conditions', () => {
    const rows = liftTable(corpus(), deps)
    expect(rows.some((r) => r.dimension === 'map' && r.key === 'ilios')).toBe(true)
    expect(rows.some((r) => r.dimension === 'mode' && r.key === 'control')).toBe(true)
    const buddy = rows.find((r) => r.dimension === 'teammate' && r.key === 'Buddy#123')!
    expect(buddy.n).toBe(12)
    // Every game is at 20:00 → the evening time bucket covers the whole
    // corpus and says nothing → dropped. Same for any ~complete condition.
    expect(rows.some((r) => r.dimension === 'time')).toBe(false)
    // No condition below minN appears.
    expect(rows.every((r) => r.n >= 5)).toBe(true)
  })

  it('sorts by lift magnitude and flags small samples', () => {
    const rows = liftTable(corpus(), deps)
    for (let i = 1; i < rows.length; i++) {
      expect(Math.abs(rows[i - 1]!.lift - 1)).toBeGreaterThanOrEqual(Math.abs(rows[i]!.lift - 1) - 1e-12)
    }
    expect(rows.find((r) => r.n < 10)?.lowSample ?? true).toBe(true)
  })

  it('is empty on an empty corpus', () => {
    expect(liftTable([], deps)).toEqual([])
  })
})

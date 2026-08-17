import { describe, it, expect } from 'vitest'

import { detectChangePoint, changePointContext } from '@/match/elo/elo-changepoint'

const DAY = 86_400_000
function timeline(wins: boolean[]): { t: number; win: boolean }[] {
  return wins.map((win, i) => ({ t: Date.UTC(2026, 2, 1) + i * DAY, win }))
}

describe('detectChangePoint', () => {
  it('finds a constructed 80% → 40% break at the block boundary', () => {
    // The max-over-splits selection penalty is real: a 25-pt break over
    // 40+40 games (G ≈ 6.9) does NOT clear the permutation bar — by
    // design. This one (40 pts over 50+50, G ≈ 17) decisively does.
    const seq = [
      ...Array.from({ length: 50 }, (_, i) => i % 5 !== 4), // 40W/10L
      ...Array.from({ length: 50 }, (_, i) => i % 5 < 2), // 20W/30L
    ]
    const cp = detectChangePoint(timeline(seq))!
    expect(cp).not.toBeNull()
    expect(cp.index).toBeGreaterThanOrEqual(46)
    expect(cp.index).toBeLessThanOrEqual(54)
    expect(cp.before.winrate).toBeGreaterThanOrEqual(75)
    expect(cp.after.winrate).toBeLessThanOrEqual(45)
    expect(cp.deltaPts).toBeLessThanOrEqual(-30)
    expect(cp.pValue).toBeLessThan(0.05)
    // The break's timestamp is the first game of the new regime.
    expect(cp.t).toBe(Date.UTC(2026, 2, 1) + cp.index * DAY)
  })

  it('is deterministic for a fixed seed', () => {
    const seq = [
      ...Array.from({ length: 50 }, (_, i) => i % 5 !== 4),
      ...Array.from({ length: 50 }, (_, i) => i % 5 < 2),
    ]
    expect(detectChangePoint(timeline(seq), { seed: 9 }))
      .toEqual(detectChangePoint(timeline(seq), { seed: 9 }))
  })

  it('reports nothing on a homogeneous sequence', () => {
    const seq = Array.from({ length: 80 }, (_, i) => i % 5 < 3) // steady 60%
    expect(detectChangePoint(timeline(seq))).toBeNull()
  })

  it('needs two full minimum segments', () => {
    const seq = Array.from({ length: 29 }, (_, i) => i % 2 === 0)
    expect(detectChangePoint(timeline(seq), { minSegment: 15 })).toBeNull()
  })
})

describe('changePointContext', () => {
  const breakT = Date.UTC(2026, 2, 20)
  function rec(daysFromBreak: number, hero: string, reviewedAt?: string) {
    const t = new Date(breakT + daysFromBreak * DAY)
    const day = t.toISOString().slice(0, 10)
    return {
      match_key: `m${daysFromBreak}-${hero}`,
      ...(reviewedAt ? { reviewed_by: 'self', reviewed_at: reviewedAt } : {}),
      data: {
        result: daysFromBreak % 2 === 0 ? 'victory' : 'defeat',
        hero,
        date: day,
        finished_at: '12:00',
        heroes_played: [{ hero, percent_played: 100 }],
      },
    } as never
  }

  it('spots a review habit starting near the break and a pool change across it', () => {
    const rows = [
      // Before: ana era, never reviewed. 12 games (pool-eligible).
      ...Array.from({ length: 12 }, (_, i) => rec(-20 + i, 'ana')),
      // After: lucio era, reviews begin 3 days after the break.
      ...Array.from({ length: 12 }, (_, i) =>
        rec(2 + i, 'lucio', i === 1 ? new Date(breakT + 3 * DAY).toISOString() : undefined)),
    ]
    const ctx = changePointContext(rows, breakT, () => 'support')
    expect(ctx.reviewStarted).toBe(true)
    expect(ctx.poolEntered).toContain('lucio')
    expect(ctx.poolLeft).toContain('ana')
  })

  it('stays quiet when nothing correlates', () => {
    const rows = Array.from({ length: 24 }, (_, i) => rec(-12 + i, 'lucio'))
    const ctx = changePointContext(rows, breakT, () => 'support')
    expect(ctx.reviewStarted).toBe(false)
    expect(ctx.poolEntered).toEqual([])
    expect(ctx.poolLeft).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'

import {
  splitTrailingWindow, winrateVsBaseline, performanceVsRank, judgeClimb, climbVelocity,
} from '@/match/dossier/match-baseline-helpers'

const DAY = 86_400_000

function rec(daysAgo: number, result?: 'victory' | 'defeat', change?: number) {
  const d = new Date(Date.now() - daysAgo * DAY)
  return {
    match_key: `m${daysAgo}-${result ?? 'x'}-${change ?? 'n'}-${Math.random()}`,
    data: {
      date: d.toISOString().slice(0, 10),
      finished_at: '20:00',
      ...(result ? { result } : {}),
      ...(change === undefined ? {} : { change_percent: change }),
    },
  }
}

// The windows must be DISJOINT. A recent slice compared against a baseline that
// contains it is a sample measured against itself, which drags every z toward
// zero and under-reports exactly the changes this is built to find.
describe('splitTrailingWindow', () => {
  it('puts no record in both windows', () => {
    const records = [rec(1), rec(3), rec(10), rec(20)]
    const { recent, baseline } = splitTrailingWindow(records, 7, 30)

    const recentKeys = new Set(recent.map((r) => r.match_key))
    expect(baseline.every((r) => !recentKeys.has(r.match_key))).toBe(true)
    expect(recent).toHaveLength(2)
    expect(baseline).toHaveLength(2)
  })

  // Anchored on the newest MATCH, not on wall-clock now: a player who stopped
  // on Tuesday still gets their last week rather than an empty one.
  it('anchors on the latest match rather than today', () => {
    // Newest is 40 days old, so "the last 7 days" means 40-47 days ago. A
    // wall-clock anchor would put every one of these outside the window and
    // report an empty week to a player who simply has not played since.
    const { recent, baseline } = splitTrailingWindow([rec(40), rec(42), rec(60)], 7, 30)

    expect(recent).toHaveLength(2)
    expect(baseline).toHaveLength(1)
  })

  it('is empty for records with no placeable time', () => {
    const { recent, baseline } = splitTrailingWindow([{ match_key: 'x', data: {} }], 7, 30)

    expect(recent).toHaveLength(0)
    expect(baseline).toHaveLength(0)
  })
})

describe('winrateVsBaseline', () => {
  const many = (daysAgo: number, n: number, wins: number) =>
    Array.from({ length: n }, (_, i) => rec(daysAgo, i < wins ? 'victory' : 'defeat'))

  // Refusing to answer is the point. A three-match sample swinging twenty
  // points is not evidence, and reporting a sigma for it would dress noise as a
  // finding.
  it('withholds a verdict below the sample floor', () => {
    const got = winrateVsBaseline([...many(2, 3, 3), ...many(20, 3, 0)])

    expect(got.sigma).toBeNull()
    expect(got.pValue).toBeNull()
    expect(got.recentRate).toBe(1)
  })

  it('reports a positive sigma when the recent window beats the baseline', () => {
    const got = winrateVsBaseline([...many(2, 20, 16), ...many(20, 20, 8)])

    expect(got.sigma).not.toBeNull()
    expect(got.sigma!).toBeGreaterThan(1)
    expect(got.pValue!).toBeLessThan(0.05)
  })

  it('reports a negative sigma when it falls short', () => {
    const got = winrateVsBaseline([...many(2, 20, 4), ...many(20, 20, 14)])

    expect(got.sigma!).toBeLessThan(-1)
  })

  it('is null-rated with no decisive games at all', () => {
    const got = winrateVsBaseline([rec(1), rec(20)])

    expect(got.recentRate).toBeNull()
    expect(got.baselineRate).toBeNull()
    expect(got.sigma).toBeNull()
  })
})

describe('judgeClimb', () => {
  it('calls a strong week with no rank movement deflation', () => {
    expect(judgeClimb(2.1, -5)).toBe('deflation')
    expect(judgeClimb(2.1, 0)).toBe('deflation')
  })

  it('calls a weak week that still climbed lucky', () => {
    expect(judgeClimb(-2.1, 30)).toBe('lucky')
  })

  it('says matched when the two agree', () => {
    expect(judgeClimb(2.1, 40)).toBe('matched')
    expect(judgeClimb(0.2, 5)).toBe('matched')
  })

  // The distinction the whole widget rests on: an unread movement is not a
  // rank that failed to move, so it cannot be evidence of deflation.
  it('says unknown when there is no movement reading', () => {
    expect(judgeClimb(2.1, null)).toBe('unknown')
    expect(judgeClimb(null, 30)).toBe('unknown')
  })
})

describe('performanceVsRank', () => {
  const many = (daysAgo: number, n: number, wins: number, change?: number) =>
    Array.from({ length: n }, (_, i) => rec(daysAgo, i < wins ? 'victory' : 'defeat', change))

  it('reports deflation when the play beat the baseline but the rank did not move', () => {
    const got = performanceVsRank([...many(2, 20, 16, -1), ...many(20, 20, 8)])

    expect(got.verdict).toBe('deflation')
    expect(got.netPercent).toBeLessThanOrEqual(0)
  })

  // netPercent stays NULL rather than 0 when nothing reported: reading an
  // unread pill as "the rank did not move" is how this widget would invent
  // deflation that never happened.
  it('reports unknown, not deflation, when no capture read a movement', () => {
    const got = performanceVsRank([...many(2, 20, 16), ...many(20, 20, 8)])

    expect(got.netPercent).toBeNull()
    expect(got.readCount).toBe(0)
    expect(got.verdict).toBe('unknown')
  })
})

describe('climbVelocity', () => {
  it('divides the movement by sessions and weeks', () => {
    const got = climbVelocity([rec(1, 'victory', 20), rec(2, 'victory', 20)], { days: 14 })

    // Both denominators come from the window itself. These two matches are a
    // day apart, well beyond the 3-hour session gap, so they are two sessions:
    // 40 points over 2 sessions and over 2 weeks.
    expect(got.perSession).toBe(20)
    expect(got.perWeek).toBe(20)
    expect(got.readCount).toBe(2)
  })

  it('is null, not zero, when nothing reported a movement', () => {
    const got = climbVelocity([rec(1, 'victory'), rec(2, 'defeat')], { days: 14 })

    expect(got.perSession).toBeNull()
    expect(got.perWeek).toBeNull()
  })
})

// Two defects the Phase 2 review confirmed in this kernel.
describe('coverage and denominators', () => {
  const DAY2 = 86_400_000
  const r = (daysAgo: number, result: 'victory' | 'defeat', change?: number) => ({
    match_key: `c${daysAgo}-${Math.random()}`,
    data: {
      date: new Date(Date.now() - daysAgo * DAY2).toISOString().slice(0, 10),
      finished_at: '20:00', result,
      ...(change === undefined ? {} : { change_percent: change }),
    },
  })

  // The play side was gated at MIN_SAMPLE while the rank side it was compared
  // against could be a sample of ONE — so a single legible pill in a twenty
  // match window decided "deflation" for the whole week.
  it('will not judge the climb from one legible pill in a full window', () => {
    const recent = [
      ...Array.from({ length: 19 }, (_, i) => r(1 + (i % 5), i < 16 ? 'victory' : 'defeat')),
      r(2, 'victory', -30), // the lone reading
    ]
    const baseline = Array.from({ length: 20 }, (_, i) => r(20 + (i % 5), i < 8 ? 'victory' : 'defeat'))

    const got = performanceVsRank([...recent, ...baseline])

    expect(got.readCount).toBe(1)
    expect(got.readOf).toBe(20)
    expect(got.netPercent).toBeNull()
    expect(got.verdict).toBe('unknown')
  })

  it('judges once enough of the window reported a movement', () => {
    const recent = Array.from({ length: 20 }, (_, i) => r(1 + (i % 5), i < 16 ? 'victory' : 'defeat', -2))
    const baseline = Array.from({ length: 20 }, (_, i) => r(20 + (i % 5), i < 8 ? 'victory' : 'defeat'))

    const got = performanceVsRank([...recent, ...baseline])

    expect(got.netPercent).not.toBeNull()
    expect(got.verdict).toBe('deflation')
  })

  // The numerator was a 30-day movement; the denominator was every session in
  // the record set. A year of history made the reported climb rate a fraction
  // of the truth.
  it('divides by the sessions inside the window, not the whole history', () => {
    const inWindow = [r(1, 'victory', 30)]
    const ancient = Array.from({ length: 10 }, (_, i) => r(200 + i * 5, 'victory', 50))

    const got = climbVelocity([...inWindow, ...ancient], { days: 30 })

    // One session in the window, so the whole 30 lands on it — not 30/11.
    expect(got.sessions).toBe(1)
    expect(got.perSession).toBe(30)
  })
})

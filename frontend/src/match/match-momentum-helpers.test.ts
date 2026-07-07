import { describe, it, expect } from 'vitest'

import {
  winrateAfterResult,
  firstGameOfSessionWinrate,
  netRankProgress,
  leaverRate,
  sessionCount,
  tiltNudgeSignal,
  currentSessionSummary,
  type MomentumInput,
} from '@/match/match-momentum-helpers'

function rec(
  date: string,
  time: string,
  s: { result?: 'victory' | 'defeat' | 'draw'; change?: number; leaver?: 'self' | 'team' | 'enemy' } = {},
): MomentumInput {
  return {
    match_key: `match-${date}T${time.replace(':', '-')}-00`,
    data: {
      date,
      finished_at: time,
      ...(s.result ? { result: s.result } : {}),
      ...(s.change != null ? { change_percent: s.change } : {}),
    },
    annotation: s.leaver ? { leaver: s.leaver } : undefined,
  }
}

// V, D, V, V, D in chronological order.
const SEQ = [
  rec('2026-05-10', '20:00', { result: 'victory' }),
  rec('2026-05-10', '20:30', { result: 'defeat' }),
  rec('2026-05-10', '21:00', { result: 'victory' }),
  rec('2026-05-10', '21:30', { result: 'victory' }),
  rec('2026-05-10', '22:00', { result: 'defeat' }),
]

describe('winrateAfterResult', () => {
  it('measures win-rate of the game following a loss (the tilt signal)', () => {
    // Only one game follows a loss (the V at 21:00) → 100% over 1.
    expect(winrateAfterResult(SEQ, 'defeat')).toEqual({ winrate: 100, sample: 1 })
  })

  it('measures win-rate following a win', () => {
    // Three games follow a win (D, V, D) → 1/3 → 33%.
    expect(winrateAfterResult(SEQ, 'victory')).toEqual({ winrate: 33, sample: 3 })
  })

  it('returns a null rate with an empty sample when nothing qualifies', () => {
    expect(winrateAfterResult([rec('2026-05-10', '20:00', { result: 'victory' })], 'defeat')).toEqual({ winrate: null, sample: 0 })
  })
})

describe('firstGameOfSessionWinrate + sessionCount', () => {
  // Two sessions a day apart: [V, D] then (23h gap) [D, V].
  const SESSIONS = [
    rec('2026-05-10', '20:00', { result: 'victory' }),
    rec('2026-05-10', '21:00', { result: 'defeat' }),
    rec('2026-05-11', '20:00', { result: 'defeat' }),
    rec('2026-05-11', '21:00', { result: 'victory' }),
  ]

  it('averages the session-opening games (V then D → 50%)', () => {
    expect(firstGameOfSessionWinrate(SESSIONS)).toEqual({ winrate: 50, sample: 2 })
  })

  it('counts the play sessions via the time-gap', () => {
    expect(sessionCount(SESSIONS)).toBe(2)
    // Same-day cluster within the gap is one session.
    expect(sessionCount([rec('2026-05-10', '20:00'), rec('2026-05-10', '21:00')])).toBe(1)
  })
})

describe('netRankProgress', () => {
  it('sums change_percent within the last N days of play (anchored on the latest match)', () => {
    const sum = netRankProgress([
      rec('2026-05-01', '20:00', { change: 100 }), // outside the 7-day window from 05-12
      rec('2026-05-10', '20:00', { change: 10 }),
      rec('2026-05-11', '20:00', { change: 20 }),
      rec('2026-05-12', '20:00', { change: -5 }),
    ], 7)
    expect(sum).toBe(25)
  })

  it('is zero for an empty set', () => {
    expect(netRankProgress([], 7)).toBe(0)
  })
})

describe('leaverRate', () => {
  it('reports the share of matches flagged with a leaver', () => {
    expect(leaverRate([
      rec('2026-05-10', '20:00', { leaver: 'team' }),
      rec('2026-05-10', '21:00', {}),
      rec('2026-05-10', '22:00', {}),
      rec('2026-05-10', '23:00', {}),
    ])).toEqual({ rate: 25, leaverCount: 1, total: 4 })
  })

  it('returns a null rate on an empty set', () => {
    expect(leaverRate([])).toEqual({ rate: null, leaverCount: 0, total: 0 })
  })
})

describe('tiltNudgeSignal', () => {
  const m = (key: string, day: number, hour: number, result: string, e: number, d: number) => ({
    match_key: key,
    data: {
      date: `2026-05-${String(day).padStart(2, '0')}`,
      finished_at: `${String(hour).padStart(2, '0')}:00`,
      result,
      eliminations: e,
      deaths: d,
    },
  }) as unknown as MomentumInput

  const healthyBaseline = () =>
    Array.from({ length: 8 }, (_, i) => m(`w${i}`, i + 1, 10, 'victory', 20, 5))

  it('fires on ≥3 trailing losses with a >25% K/D collapse', () => {
    const records = [
      ...healthyBaseline(),
      m('l1', 11, 20, 'defeat', 4, 9),
      m('l2', 11, 21, 'defeat', 3, 10),
      m('l3', 11, 22, 'defeat', 5, 8),
    ]
    const sig = tiltNudgeSignal(records)
    expect(sig).not.toBeNull()
    expect(sig!.losses).toBe(3)
    expect(sig!.streakKey).toBe('l1')
    expect(sig!.dropPercent).toBeGreaterThan(25)
  })

  it('stays silent below three losses, without the collapse, or on a thin baseline', () => {
    const twoLosses = [...healthyBaseline(), m('l1', 11, 20, 'defeat', 4, 9), m('l2', 11, 21, 'defeat', 3, 10)]
    expect(tiltNudgeSignal(twoLosses)).toBeNull()

    const goodKD = [
      ...healthyBaseline(),
      m('l1', 11, 20, 'defeat', 19, 5),
      m('l2', 11, 21, 'defeat', 20, 5),
      m('l3', 11, 22, 'defeat', 18, 5),
    ]
    expect(tiltNudgeSignal(goodKD)).toBeNull()

    const thin = [
      m('w1', 1, 10, 'victory', 20, 5),
      m('l1', 11, 20, 'defeat', 4, 9),
      m('l2', 11, 21, 'defeat', 3, 10),
      m('l3', 11, 22, 'defeat', 5, 8),
    ]
    expect(tiltNudgeSignal(thin)).toBeNull()
  })

  it('a win between streaks resets the dismissal key', () => {
    const records = [
      ...healthyBaseline(),
      m('l1', 11, 20, 'defeat', 4, 9),
      m('l2', 11, 21, 'defeat', 3, 10),
      m('l3', 11, 22, 'defeat', 5, 8),
      m('w9', 12, 10, 'victory', 20, 5),
      m('n1', 12, 20, 'defeat', 4, 9),
      m('n2', 12, 21, 'defeat', 3, 10),
      m('n3', 12, 22, 'defeat', 5, 8),
    ]
    expect(tiltNudgeSignal(records)!.streakKey).toBe('n1')
  })
})

describe('currentSessionSummary', () => {
  const m = (key: string, day: number, hh: number, mm: number, result: string) => ({
    match_key: key,
    data: {
      date: `2026-05-${String(day).padStart(2, '0')}`,
      finished_at: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      result,
    },
  }) as unknown as MomentumInput
  const epoch = (day: number, hh: number, mm: number) =>
    new Date(2026, 4, day, hh, mm).getTime()

  it('tallies the trailing session while it is active', () => {
    const records = [
      m('old', 10, 10, 0, 'victory'), // separate morning session
      m('a', 10, 19, 0, 'victory'),
      m('b', 10, 20, 0, 'victory'),
      m('c', 10, 21, 0, 'defeat'),
    ]
    const sum = currentSessionSummary(records, epoch(10, 21, 30))
    expect(sum).toEqual({ matches: 3, w: 2, l: 1, d: 0 })
  })

  it('null once the latest match falls outside the gap (stale history)', () => {
    const records = [m('a', 3, 19, 0, 'victory'), m('b', 3, 20, 0, 'defeat')]
    expect(currentSessionSummary(records, epoch(10, 21, 0))).toBeNull()
  })

  it('null with no timed matches', () => {
    expect(currentSessionSummary([{ match_key: 'x', data: {} } as unknown as MomentumInput], epoch(10, 21, 0))).toBeNull()
  })
})

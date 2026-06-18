import { describe, it, expect } from 'vitest'

import {
  winrateAfterResult,
  firstGameOfSessionWinrate,
  netRankProgress,
  leaverRate,
  sessionCount,
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

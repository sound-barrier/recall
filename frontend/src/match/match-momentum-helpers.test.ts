import { describe, it, expect } from 'vitest'

import {
  breakRust,
  formDelta,
  winrateAfterLossStreak,
  winrateAfterResult,
  firstGameOfSessionWinrate,
  netRankProgress,
  leaverRate,
  sessionCount,
  tiltNudgeSignal,
  currentSessionSummary,
  winrateBySessionIndex,
  type MomentumInput,
} from '@/match/match-momentum-helpers'

function rec(
  date: string,
  time: string,
  s: { result?: 'victory' | 'defeat' | 'draw'; change?: number; leavers?: ('self' | 'team' | 'enemy')[] } = {},
): MomentumInput {
  return {
    match_key: `match-${date}T${time.replace(':', '-')}-00`,
    data: {
      date,
      finished_at: time,
      ...(s.result ? { result: s.result } : {}),
      ...(s.change != null ? { change_percent: s.change } : {}),
    },
    annotation: s.leavers?.length ? { leavers: s.leavers, throwers: [] } : undefined,
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
      rec('2026-05-10', '20:00', { leavers: ['team'] }),
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
  const m = (key: string, opts: { day: number; hour: number; result: string; e: number; d: number }) => ({
    match_key: key,
    data: {
      date: `2026-05-${String(opts.day).padStart(2, '0')}`,
      finished_at: `${String(opts.hour).padStart(2, '0')}:00`,
      result: opts.result,
      eliminations: opts.e,
      deaths: opts.d,
    },
  }) as unknown as MomentumInput

  const healthyBaseline = () =>
    Array.from({ length: 8 }, (_, i) => m(`w${i}`, { day: i + 1, hour: 10, result: 'victory', e: 20, d: 5 }))

  it('fires on ≥3 trailing losses with a >25% K/D collapse', () => {
    const records = [
      ...healthyBaseline(),
      m('l1', { day: 11, hour: 20, result: 'defeat', e: 4, d: 9 }),
      m('l2', { day: 11, hour: 21, result: 'defeat', e: 3, d: 10 }),
      m('l3', { day: 11, hour: 22, result: 'defeat', e: 5, d: 8 }),
    ]
    const sig = tiltNudgeSignal(records)
    expect(sig).not.toBeNull()
    expect(sig!.losses).toBe(3)
    expect(sig!.streakKey).toBe('l1')
    expect(sig!.dropPercent).toBeGreaterThan(25)
  })

  it('stays silent below three losses, without the collapse, or on a thin baseline', () => {
    const twoLosses = [...healthyBaseline(), m('l1', { day: 11, hour: 20, result: 'defeat', e: 4, d: 9 }), m('l2', { day: 11, hour: 21, result: 'defeat', e: 3, d: 10 })]
    expect(tiltNudgeSignal(twoLosses)).toBeNull()

    const goodKD = [
      ...healthyBaseline(),
      m('l1', { day: 11, hour: 20, result: 'defeat', e: 19, d: 5 }),
      m('l2', { day: 11, hour: 21, result: 'defeat', e: 20, d: 5 }),
      m('l3', { day: 11, hour: 22, result: 'defeat', e: 18, d: 5 }),
    ]
    expect(tiltNudgeSignal(goodKD)).toBeNull()

    const thin = [
      m('w1', { day: 1, hour: 10, result: 'victory', e: 20, d: 5 }),
      m('l1', { day: 11, hour: 20, result: 'defeat', e: 4, d: 9 }),
      m('l2', { day: 11, hour: 21, result: 'defeat', e: 3, d: 10 }),
      m('l3', { day: 11, hour: 22, result: 'defeat', e: 5, d: 8 }),
    ]
    expect(tiltNudgeSignal(thin)).toBeNull()
  })

  it('a win between streaks resets the dismissal key', () => {
    const records = [
      ...healthyBaseline(),
      m('l1', { day: 11, hour: 20, result: 'defeat', e: 4, d: 9 }),
      m('l2', { day: 11, hour: 21, result: 'defeat', e: 3, d: 10 }),
      m('l3', { day: 11, hour: 22, result: 'defeat', e: 5, d: 8 }),
      m('w9', { day: 12, hour: 10, result: 'victory', e: 20, d: 5 }),
      m('n1', { day: 12, hour: 20, result: 'defeat', e: 4, d: 9 }),
      m('n2', { day: 12, hour: 21, result: 'defeat', e: 3, d: 10 }),
      m('n3', { day: 12, hour: 22, result: 'defeat', e: 5, d: 8 }),
    ]
    expect(tiltNudgeSignal(records)!.streakKey).toBe('n1')
  })
})

describe('currentSessionSummary', () => {
  const m = (key: string, opts: { day: number; hh: number; mm: number; result: string }) => ({
    match_key: key,
    data: {
      date: `2026-05-${String(opts.day).padStart(2, '0')}`,
      finished_at: `${String(opts.hh).padStart(2, '0')}:${String(opts.mm).padStart(2, '0')}`,
      result: opts.result,
    },
  }) as unknown as MomentumInput
  const epoch = (day: number, hh: number, mm: number) =>
    new Date(2026, 4, day, hh, mm).getTime()

  it('tallies the trailing session while it is active', () => {
    const records = [
      m('old', { day: 10, hh: 10, mm: 0, result: 'victory' }), // separate morning session
      m('a', { day: 10, hh: 19, mm: 0, result: 'victory' }),
      m('b', { day: 10, hh: 20, mm: 0, result: 'victory' }),
      m('c', { day: 10, hh: 21, mm: 0, result: 'defeat' }),
    ]
    const sum = currentSessionSummary(records, epoch(10, 21, 30))
    expect(sum).toEqual({ matches: 3, w: 2, l: 1, d: 0 })
  })

  it('null once the latest match falls outside the gap (stale history)', () => {
    const records = [m('a', { day: 3, hh: 19, mm: 0, result: 'victory' }), m('b', { day: 3, hh: 20, mm: 0, result: 'defeat' })]
    expect(currentSessionSummary(records, epoch(10, 21, 0))).toBeNull()
  })

  it('null with no timed matches', () => {
    expect(currentSessionSummary([{ match_key: 'x', data: {} } as unknown as MomentumInput], epoch(10, 21, 0))).toBeNull()
  })
})

describe('winrateBySessionIndex', () => {
  it('buckets by game-number-in-session with the 4+ pool and exact rates', () => {
    const rows = [
      // Session 1 (day 1, gaps < 3h): W W W L at indexes 1-4.
      rec('2026-05-01', '10:00', { result: 'victory' }),
      rec('2026-05-01', '10:20', { result: 'victory' }),
      rec('2026-05-01', '11:00', { result: 'victory' }),
      rec('2026-05-01', '12:00', { result: 'defeat' }),
      // Session 2 (same day, 5h gap): W L.
      rec('2026-05-01', '17:00', { result: 'victory' }),
      rec('2026-05-01', '17:30', { result: 'defeat' }),
      // Session 3 (next morning): L.
      rec('2026-05-02', '09:00', { result: 'defeat' }),
    ]
    const b = winrateBySessionIndex(rows, { maxIndex: 3 })
    expect(b.sessions).toBe(3)
    expect(b.buckets).toEqual([
      { index: 1, winrate: 67, wins: 2, sample: 3 },
      { index: 2, winrate: 50, wins: 1, sample: 2 },
      { index: 3, winrate: 50, wins: 1, sample: 2 }, // idx 3 + idx 4 pooled
    ])
    // 7 decisive games — under the logistic fit's floor.
    expect(b.slope).toBeNull()
  })

  it('fits a negative slope on a late-session sag', () => {
    const rows: ReturnType<typeof rec>[] = []
    for (let d = 1; d <= 10; d++) {
      const day = `2026-05-${String(d).padStart(2, '0')}`
      // ~90 / 70 / 50 / 30% by index — a sag, not a cliff (a perfect
      // 100→0 gradient is quasi-separated and the fit rightly refuses it).
      const results = [d !== 10, d <= 7, d % 2 === 0, d <= 3]
      results.forEach((win, i) => {
        rows.push(rec(day, `${10 + i}:0${i}`, { result: win ? 'victory' : 'defeat' }))
      })
    }
    const b = winrateBySessionIndex(rows)
    expect(b.sessions).toBe(10)
    expect(b.buckets[0]).toEqual({ index: 1, winrate: 90, wins: 9, sample: 10 })
    expect(b.buckets[3]).toEqual({ index: 4, winrate: 30, wins: 3, sample: 10 })
    expect(b.slope).not.toBeNull()
    expect(b.slope!.slope).toBeLessThan(0)
  })
})

describe('breakRust', () => {
  it('splits the sequence at 7+ day gaps and compares the first games back', () => {
    const rows = [
      // Steady week: 6 games, 4W.
      rec('2026-04-01', '20:00', { result: 'victory' }),
      rec('2026-04-02', '20:00', { result: 'victory' }),
      rec('2026-04-03', '20:00', { result: 'defeat' }),
      rec('2026-04-04', '20:00', { result: 'victory' }),
      rec('2026-04-05', '20:00', { result: 'victory' }),
      rec('2026-04-06', '20:00', { result: 'defeat' }),
      // 10-day vacation → the first 3 back count as rusty (window 3).
      rec('2026-04-16', '20:00', { result: 'defeat' }),
      rec('2026-04-17', '20:00', { result: 'defeat' }),
      rec('2026-04-18', '20:00', { result: 'victory' }),
      // Back to normal.
      rec('2026-04-19', '20:00', { result: 'victory' }),
    ]
    const r = breakRust(rows, { gapDays: 7, window: 3 })
    expect(r.breaks).toBe(1)
    expect(r.back).toEqual({ winrate: 33, sample: 3 })
    expect(r.rest).toEqual({ winrate: 71, sample: 7 }) // 5W/7 = 71%
  })

  it('a 6-day gap is a busy week, not a break', () => {
    const rows = [
      rec('2026-04-01', '20:00', { result: 'victory' }),
      rec('2026-04-07', '20:00', { result: 'defeat' }),
    ]
    expect(breakRust(rows, { gapDays: 7 }).breaks).toBe(0)
  })

  it('counts every qualifying gap and pools their return windows', () => {
    const rows = [
      rec('2026-03-01', '20:00', { result: 'victory' }),
      rec('2026-03-10', '20:00', { result: 'defeat' }), // break 1
      rec('2026-03-11', '20:00', { result: 'defeat' }),
      rec('2026-03-25', '20:00', { result: 'defeat' }), // break 2
      rec('2026-03-26', '20:00', { result: 'victory' }),
    ]
    const r = breakRust(rows, { gapDays: 7, window: 2 })
    expect(r.breaks).toBe(2)
    expect(r.back).toEqual({ winrate: 25, sample: 4 })
    expect(r.rest).toEqual({ winrate: 100, sample: 1 })
  })

  it('is empty-safe', () => {
    const r = breakRust([])
    expect(r.breaks).toBe(0)
    expect(r.back).toEqual({ winrate: null, sample: 0 })
  })
})

describe('formDelta', () => {
  // V V D D V D chronological — overall 3W-3L (50%), last 4 = D D V D
  // (25%) → the form read is 25% recent, -25 pts vs overall.
  const FORM = [
    rec('2026-05-10', '20:00', { result: 'victory' }),
    rec('2026-05-10', '20:30', { result: 'victory' }),
    rec('2026-05-10', '21:00', { result: 'defeat' }),
    rec('2026-05-10', '21:30', { result: 'defeat' }),
    rec('2026-05-10', '22:00', { result: 'victory' }),
    rec('2026-05-10', '22:30', { result: 'defeat' }),
  ]

  it('compares the recent window against the overall rate', () => {
    expect(formDelta(FORM, 4)).toEqual({
      recent:   { winrate: 25, sample: 4 },
      overall:  { winrate: 50, sample: 6 },
      deltaPts: -25,
    })
  })

  it('collapses to a zero delta when the corpus fits inside the window', () => {
    const r = formDelta(FORM, 20)
    expect(r.recent).toEqual(r.overall)
    expect(r.deltaPts).toBe(0)
  })

  it('returns null rates and a null delta on an empty set', () => {
    expect(formDelta([], 20)).toEqual({
      recent:   { winrate: null, sample: 0 },
      overall:  { winrate: null, sample: 0 },
      deltaPts: null,
    })
  })

  it('ignores draws — only decisive games fill the window', () => {
    const withDraw = [
      rec('2026-05-10', '20:00', { result: 'victory' }),
      rec('2026-05-10', '20:30', { result: 'draw' }),
      rec('2026-05-10', '21:00', { result: 'defeat' }),
      rec('2026-05-10', '21:30', { result: 'defeat' }),
      rec('2026-05-10', '22:00', { result: 'victory' }),
    ]
    // Decisive sequence: V L L V. Window 3 → L L V = 33%; overall 50%.
    expect(formDelta(withDraw, 3)).toEqual({
      recent:   { winrate: 33, sample: 3 },
      overall:  { winrate: 50, sample: 4 },
      deltaPts: -17,
    })
  })
})

describe('winrateAfterLossStreak', () => {
  it('measures games that follow 2+ consecutive losses', () => {
    // V L L V L L L V V — qualifying games: idx 3 (after LL) = V,
    // idx 6 (after LL) = L, idx 7 (after LLL → still ≥2) = V.
    const rows = [
      rec('2026-05-10', '20:00', { result: 'victory' }),
      rec('2026-05-10', '20:30', { result: 'defeat' }),
      rec('2026-05-10', '21:00', { result: 'defeat' }),
      rec('2026-05-10', '21:30', { result: 'victory' }),
      rec('2026-05-10', '22:00', { result: 'defeat' }),
      rec('2026-05-10', '22:30', { result: 'defeat' }),
      rec('2026-05-10', '23:00', { result: 'defeat' }),
      rec('2026-05-10', '23:30', { result: 'victory' }),
      rec('2026-05-11', '00:00', { result: 'victory' }),
    ]
    expect(winrateAfterLossStreak(rows, 2)).toEqual({ winrate: 67, sample: 3 })
  })

  it('needs the full streak length — single losses never qualify', () => {
    const rows = [
      rec('2026-05-10', '20:00', { result: 'victory' }),
      rec('2026-05-10', '20:30', { result: 'defeat' }),
      rec('2026-05-10', '21:00', { result: 'victory' }),
      rec('2026-05-10', '21:30', { result: 'defeat' }),
      rec('2026-05-10', '22:00', { result: 'victory' }),
    ]
    expect(winrateAfterLossStreak(rows, 2)).toEqual({ winrate: null, sample: 0 })
  })

  it('a longer floor tightens the trigger', () => {
    // L L V … only a 2-streak exists, so minStreak 3 finds nothing.
    const rows = [
      rec('2026-05-10', '20:00', { result: 'defeat' }),
      rec('2026-05-10', '20:30', { result: 'defeat' }),
      rec('2026-05-10', '21:00', { result: 'victory' }),
    ]
    expect(winrateAfterLossStreak(rows, 2)).toEqual({ winrate: 100, sample: 1 })
    expect(winrateAfterLossStreak(rows, 3)).toEqual({ winrate: null, sample: 0 })
  })
})

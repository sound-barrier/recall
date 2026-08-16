import { describe, it, expect } from 'vitest'

import {
  flattenReel,
  groupReelByPlayerDay,
  neighborKey,
  reelDayHeader,
} from '@/match/coach-reel-helpers'

const thisYear = new Date().getFullYear()

interface Spec {
  date?: string
  time?: string
  result?: 'victory' | 'defeat' | 'draw'
  key?: string
  hidden?: boolean
}

// Every played_at_utc sits 9 h off the naive fields, so a helper that
// grouped or ordered by the instant would put the 22:30 match on the
// NEXT day.
function rec(spec: Spec) {
  const key = spec.key ?? `match-${spec.date ?? '0000-00-00'}T${(spec.time ?? '00:00').replace(':', '-')}-00`
  return {
    match_key: key,
    hidden: spec.hidden,
    data: {
      date: spec.date,
      finished_at: spec.time,
      result: spec.result,
      played_at_utc: spec.date && spec.time ? `${spec.date}T${spec.time}:00Z` : undefined,
    },
  }
}

const dayA = `${thisYear}-08-08`
const dayB = `${thisYear}-08-07`
const dayC = `${thisYear}-08-05`

// Fed OLDEST-first and shuffled within a day, so the output order is
// the helper's doing.
const corpus = [
  rec({ date: dayC, time: '19:31', result: 'defeat' }),
  rec({ date: dayB, time: '20:05', result: 'victory' }),
  rec({ date: dayA, time: '21:14', result: 'victory' }),
  rec({ date: dayA, time: '22:30', result: 'victory' }),
  rec({ date: dayA, time: '21:52', result: 'defeat' }),
  rec({ date: dayB, time: '20:47', result: 'draw' }),
]

describe('groupReelByPlayerDay', () => {
  it("groups by the player's naive day, newest day first", () => {
    const days = groupReelByPlayerDay(corpus)
    expect(days.map((d) => d.dayKey)).toEqual([dayA, dayB, dayC])
    expect(days.map((d) => d.played)).toEqual([3, 2, 1])
  })

  it('orders the frames within a day newest first by the naive clock', () => {
    const [first] = groupReelByPlayerDay(corpus)
    expect(first!.frames.map((r) => r.data.finished_at)).toEqual(['22:30', '21:52', '21:14'])
  })

  it('tallies W/L/D per day', () => {
    const days = groupReelByPlayerDay(corpus)
    expect(days[0]!.wld).toEqual({ w: 2, l: 1, d: 0 })
    expect(days[1]!.wld).toEqual({ w: 1, l: 0, d: 1 })
  })

  it('labels a day with its weekday and naive date', () => {
    // 2026-08-08 is a Saturday.
    const days = groupReelByPlayerDay([rec({ date: '2026-08-08', time: '20:00', result: 'victory' })])
    expect(days[0]!.label).toMatch(/^Sat · Aug 8/)
  })

  it('excludes hidden records', () => {
    const days = groupReelByPlayerDay([
      rec({ date: dayA, time: '21:14', result: 'victory' }),
      rec({ date: dayA, time: '21:52', result: 'defeat', hidden: true }),
    ])
    expect(days[0]!.played).toBe(1)
    expect(days[0]!.wld).toEqual({ w: 1, l: 0, d: 0 })
  })

  it('collects undated records into a trailing "Undated" day', () => {
    const days = groupReelByPlayerDay([
      rec({ key: 'unmatched-foo.png', result: 'defeat' }),
      rec({ date: dayA, time: '21:14', result: 'victory' }),
    ])
    expect(days.map((d) => d.dayKey)).toEqual([dayA, ''])
    expect(days[1]!.label).toBe('Undated')
    expect(days[1]!.played).toBe(1)
  })

  it('falls back to the raw key as the label when a date is not a calendar day', () => {
    const days = groupReelByPlayerDay([rec({ date: '2026-13-40', time: '20:00' })])
    expect(days[0]!.label).toBe('2026-13-40')
  })

  it('breaks a same-minute tie by match key so the order is stable', () => {
    const days = groupReelByPlayerDay([
      rec({ date: dayA, time: '21:14', key: 'match-a' }),
      rec({ date: dayA, time: '21:14', key: 'match-b' }),
    ])
    expect(days[0]!.frames.map((r) => r.match_key)).toEqual(['match-b', 'match-a'])
  })

  it('is empty for no records', () => {
    expect(groupReelByPlayerDay([])).toEqual([])
  })
})

describe('reelDayHeader', () => {
  it('reads "<label> · N played · W–L"', () => {
    expect(reelDayHeader({ label: 'Fri · Aug 8', played: 4, wld: { w: 2, l: 2, d: 0 } })).toBe('Fri · Aug 8 · 4 played · 2–2')
  })

  it('appends draws third only when there are any', () => {
    expect(reelDayHeader({ label: 'Fri · Aug 8', played: 3, wld: { w: 1, l: 1, d: 1 } })).toBe('Fri · Aug 8 · 3 played · 1–1–1')
  })

  it('works for the undated day', () => {
    expect(reelDayHeader({ label: 'Undated', played: 1, wld: { w: 0, l: 1, d: 0 } })).toBe('Undated · 1 played · 0–1')
  })
})

describe('flattenReel + neighborKey', () => {
  const days = groupReelByPlayerDay(corpus)
  const order = flattenReel(days).map((r) => r.match_key)

  it('flattens in reel order (newest day first, newest frame first)', () => {
    expect(flattenReel(days).map((r) => r.data.finished_at)).toEqual(['22:30', '21:52', '21:14', '20:47', '20:05', '19:31'])
  })

  it('steps forward and back across day boundaries', () => {
    expect(neighborKey(days, order[2]!, 1)).toBe(order[3])
    expect(neighborKey(days, order[3]!, -1)).toBe(order[2])
  })

  it('is null at either end and for an unknown key', () => {
    expect(neighborKey(days, order[0]!, -1)).toBeNull()
    expect(neighborKey(days, order[5]!, 1)).toBeNull()
    expect(neighborKey(days, 'match-nope', 1)).toBeNull()
  })
})

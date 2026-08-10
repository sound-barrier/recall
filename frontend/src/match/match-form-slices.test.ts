import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import type { Season } from '@/composables/shared/useOWData'
import {
  buildCondition, conditionDrillable, conditionPredicate, mirrorPreviousWindow, pairByMatches,
  pairByTime, rollingWinrate, samePointWindows, trailingWindow, windowDays,
} from '@/match/match-form-slices'

function rec(date: string, over: Record<string, unknown> = {}, annotation?: Record<string, unknown>): MatchRecord {
  return {
    match_key: `m-${date}-${JSON.stringify(over).length}`,
    source_files: ['x.png'],
    annotation,
    data: { date, finished_at: '12:00', result: 'victory', ...over },
  } as unknown as MatchRecord
}

const untimedRec = { match_key: 'unmatched-x', source_files: ['u.png'], data: { result: 'victory' } } as unknown as MatchRecord

describe('window math', () => {
  it('counts inclusive days', () => {
    expect(windowDays({ from: '2026-03-03', to: '2026-03-09' })).toBe(7)
    expect(windowDays({ from: '2026-03-03', to: '2026-03-03' })).toBe(1)
  })

  it('mirrors the immediately-preceding window of identical length', () => {
    expect(mirrorPreviousWindow({ from: '2026-03-03', to: '2026-03-09' }))
      .toEqual({ from: '2026-02-24', to: '2026-03-02' })
    // Across a month boundary and a single-day window.
    expect(mirrorPreviousWindow({ from: '2026-03-01', to: '2026-03-01' }))
      .toEqual({ from: '2026-02-28', to: '2026-02-28' })
  })

  it('builds a trailing window ending today', () => {
    const w = trailingWindow(7, new Date(2026, 2, 9)) // Mar 9 local
    expect(w).toEqual({ from: '2026-03-03', to: '2026-03-09' })
  })
})

describe('pairByTime', () => {
  it('places records by local date and counts untimed ones', () => {
    const b = { from: '2026-03-03', to: '2026-03-09' }
    const a = mirrorPreviousWindow(b)
    const records = [rec('2026-03-05'), rec('2026-02-25'), rec('2026-01-01'), untimedRec]
    const pair = pairByTime(records, b, a)
    expect(pair.b).toHaveLength(1)
    expect(pair.a).toHaveLength(1)
    expect(pair.untimed).toBe(1) // the sentinel; the Jan match is simply outside both
  })
})

describe('pairByMatches', () => {
  it('takes the last n as compared and the n before as baseline, oldest-first order', () => {
    const records = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'].map((d) => rec(d))
    const pair = pairByMatches(records, 2)
    expect(pair.b.map((r) => r.data?.date)).toEqual(['2026-03-04', '2026-03-05'])
    expect(pair.a.map((r) => r.data?.date)).toEqual(['2026-03-02', '2026-03-03'])
    expect(pair.bWindow).toEqual({ from: '2026-03-04', to: '2026-03-05' })
  })

  it('yields an empty baseline when history is short, and excludes untimed rows', () => {
    const pair = pairByMatches([rec('2026-03-01'), untimedRec], 5)
    expect(pair.b).toHaveLength(1)
    expect(pair.a).toHaveLength(0)
    expect(pair.aWindow).toBeNull()
    expect(pair.untimed).toBe(1)
  })
})

describe('samePointWindows', () => {
  const seasons: Season[] = [
    { name: 'S1', chapter: 'C', number: 1, start: '2026-02-10T19:00:00Z', end: '2026-04-14T19:00:00Z' },
    { name: 'S2', chapter: 'C', number: 2, start: '2026-04-14T19:00:00Z', end: '2026-06-16T19:00:00Z' },
  ] as Season[]

  it('truncates the previous season to the same elapsed days', () => {
    // 10 days into S2 (local dates derive from the UTC starts).
    const now = new Date(2026, 3, 24, 12) // Apr 24 local
    const w = samePointWindows(seasons, now)
    expect(w).not.toBeNull()
    expect(w!.b.to).toBe('2026-04-24')
    expect(windowDays(w!.a)).toBe(windowDays(w!.b))
    expect(w!.a.from).toBe(w!.a.from.slice(0, 10)) // sane YMD
  })

  it('is null in the first season or outside every season', () => {
    expect(samePointWindows(seasons, new Date(2026, 2, 1))).toBeNull() // inside S1
    expect(samePointWindows(seasons, new Date(2027, 0, 1))).toBeNull() // after all
  })
})

describe('conditionPredicate', () => {
  const ROLES: Record<string, string> = { reinhardt: 'tank', genji: 'dps' }
  const heroRole = (h?: string | null) => ROLES[h ?? ''] ?? ''

  it('filters duo (member), solo, role, and hero', () => {
    const duo = rec('2026-03-05', { heroes_played: [{ hero: 'reinhardt' }] }, { members: ['Apollo'] })
    const solo = rec('2026-03-06', { heroes_played: [{ hero: 'genji' }] })
    expect(conditionPredicate({ kind: 'member', name: 'Apollo' }, heroRole)(duo)).toBe(true)
    expect(conditionPredicate({ kind: 'member', name: 'Apollo' }, heroRole)(solo)).toBe(false)
    expect(conditionPredicate({ kind: 'solo' }, heroRole)(solo)).toBe(true)
    expect(conditionPredicate({ kind: 'solo' }, heroRole)(duo)).toBe(false)
    expect(conditionPredicate({ kind: 'role', role: 'tank' }, heroRole)(duo)).toBe(true)
    expect(conditionPredicate({ kind: 'role', role: 'tank' }, heroRole)(solo)).toBe(false)
    expect(conditionPredicate({ kind: 'hero', hero: 'genji' }, heroRole)(solo)).toBe(true)
  })

  it('splits weekday vs weekend on the local match date', () => {
    const saturday = rec('2026-03-07')
    const monday = rec('2026-03-09')
    expect(conditionPredicate({ kind: 'weekend' }, heroRole)(saturday)).toBe(true)
    expect(conditionPredicate({ kind: 'weekend' }, heroRole)(monday)).toBe(false)
    expect(conditionPredicate({ kind: 'weekday' }, heroRole)(monday)).toBe(true)
  })

  it('marks narrow-expressible conditions drillable', () => {
    expect(conditionDrillable({ kind: 'any' })).toBe(true)
    expect(conditionDrillable({ kind: 'member', name: 'Apollo' })).toBe(true)
    expect(conditionDrillable({ kind: 'weekend' })).toBe(false)
    expect(conditionDrillable({ kind: 'solo' })).toBe(false)
  })
})

describe('buildCondition', () => {
  it('maps every select value to its condition', () => {
    expect(buildCondition('any', '', '')).toEqual({ kind: 'any' })
    expect(buildCondition('solo', '', '')).toEqual({ kind: 'solo' })
    expect(buildCondition('weekday', '', '')).toEqual({ kind: 'weekday' })
    expect(buildCondition('weekend', '', '')).toEqual({ kind: 'weekend' })
    expect(buildCondition('role:tank', '', '')).toEqual({ kind: 'role', role: 'tank' })
    expect(buildCondition('role:dps', '', '')).toEqual({ kind: 'role', role: 'dps' })
    expect(buildCondition('role:support', '', '')).toEqual({ kind: 'role', role: 'support' })
    expect(buildCondition('member', 'Apollo', '')).toEqual({ kind: 'member', name: 'Apollo' })
    expect(buildCondition('hero', '', 'genji')).toEqual({ kind: 'hero', hero: 'genji' })
  })

  it('degrades an unfilled sub-pick to "any" instead of filtering everything out', () => {
    expect(buildCondition('member', '', '')).toEqual({ kind: 'any' })
    expect(buildCondition('hero', '', '')).toEqual({ kind: 'any' })
  })
})

describe('rollingWinrate', () => {
  it('emits one trailing-window point per decisive match, skipping draws', () => {
    const records = [
      rec('2026-03-01', { result: 'victory' }),
      rec('2026-03-02', { result: 'draw' }),
      rec('2026-03-03', { result: 'defeat' }),
      rec('2026-03-04', { result: 'victory' }),
    ]
    expect(rollingWinrate(records, 2)).toEqual([100, 50, 50])
  })

  it('is empty with no decisive matches', () => {
    expect(rollingWinrate([rec('2026-03-01', { result: 'draw' })])).toEqual([])
  })
})

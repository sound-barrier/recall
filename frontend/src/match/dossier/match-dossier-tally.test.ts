import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import {
  newTally, bumpTally, bumpDecisive, sharePct, winratePct, winrateOrNull, inTrailingWindow,
} from '@/match/dossier/match-dossier-tally'

describe('bumpTally', () => {
  it('classifies each result into its own lane and counts every call in total', () => {
    const t = newTally()
    bumpTally(t, 'victory')
    bumpTally(t, 'victory')
    bumpTally(t, 'defeat')
    bumpTally(t, 'draw')
    expect(t).toEqual({ total: 4, w: 2, l: 1, d: 1 })
  })

  it('counts an unknown or missing result toward total only', () => {
    const t = newTally()
    bumpTally(t, undefined)
    bumpTally(t, 'in_progress')
    expect(t).toEqual({ total: 2, w: 0, l: 0, d: 0 })
  })
})

describe('bumpDecisive', () => {
  it('moves only decisive results — draws and unknowns leave the tally untouched', () => {
    const t = { w: 0, l: 0 }
    bumpDecisive(t, 'victory')
    bumpDecisive(t, 'defeat')
    bumpDecisive(t, 'draw')
    bumpDecisive(t, undefined)
    expect(t).toEqual({ w: 1, l: 1 })
  })
})

describe('sharePct', () => {
  it('rounds to an integer percentage', () => {
    expect(sharePct(2, 3)).toBe(67)
    expect(sharePct(1, 3)).toBe(33)
  })

  it('returns 0 on an empty denominator instead of NaN', () => {
    expect(sharePct(0, 0)).toBe(0)
  })
})

describe('winratePct', () => {
  it('computes wins over decisive games as an integer percentage', () => {
    expect(winratePct(2, 1)).toBe(67)
  })

  it('returns 0 with no decisive games (count-shaped breakdown convention)', () => {
    expect(winratePct(0, 0)).toBe(0)
  })
})

describe('winrateOrNull', () => {
  it('returns null with no decisive games so a played-but-undecided bucket reads as no-sample', () => {
    expect(winrateOrNull(0, 0)).toBeNull()
  })

  it('computes the rounded rate over the decisive count', () => {
    expect(winrateOrNull(2, 3)).toBe(67)
  })
})

describe('inTrailingWindow', () => {
  const dated = { data: { date: '2026-05-10' } } as unknown as MatchRecord
  const undated = { data: {} } as unknown as MatchRecord

  it('admits every record when the cutoff is empty (all-time)', () => {
    expect(inTrailingWindow(dated, '')).toBe(true)
    expect(inTrailingWindow(undated, '')).toBe(true)
  })

  it('drops records older than the cutoff and keeps the boundary date', () => {
    expect(inTrailingWindow(dated, '2026-05-11')).toBe(false)
    expect(inTrailingWindow(dated, '2026-05-10')).toBe(true)
    expect(inTrailingWindow(dated, '2026-05-09')).toBe(true)
  })

  it('drops undated records from any bounded window', () => {
    expect(inTrailingWindow(undated, '2020-01-01')).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import type { MatchRecord } from '@/api-client'
import { srDelta, srVelocity, srPerRole } from '@/match/dossier/match-sr-helpers'

// SR, as opposed to the meter.
//
// Every climb number the app already shows is denominated in
// `data.change_percent` — the progress meter — because that is what almost
// every rank screen reports. `data.sr[].change` is the real thing and is read
// far less often, so these say "no SR readings" rather than blanking a widget
// that was working.

const day = (n: number) => `2026-08-${String(n).padStart(2, '0')}`

function rec(d: number, sr?: { hero: string; sr: number; change: number }[]): MatchRecord {
  return {
    match_key: `m-${d}`,
    data: { date: day(d), finished_at: '20:00', result: 'victory', ...(sr ? { sr } : {}) },
  } as unknown as MatchRecord
}

describe('srDelta', () => {
  it('sums the signed SR movements in the window', () => {
    const got = srDelta([
      rec(1, [{ hero: 'ana', sr: 2500, change: 22 }]),
      rec(2, [{ hero: 'ana', sr: 2478, change: -22 }]),
      rec(3, [{ hero: 'ana', sr: 2503, change: 25 }]),
    ], 30)
    expect(got.net).toBe(25)
    expect(got.readCount).toBe(3)
  })

  it('reports null rather than zero when nothing reported SR', () => {
    // A window with no readings is unknown, not flat — the same distinction
    // the meter-denominated widgets already make.
    const got = srDelta([rec(1), rec(2)], 30)
    expect(got.net).toBeNull()
    expect(got.readCount).toBe(0)
    expect(got.readOf).toBe(2)
  })

  it('counts a match once even when several heroes reported SR', () => {
    // A match can carry a per-hero row for each role played. The MATCH moved
    // the player once; summing every row would triple-count it.
    const got = srDelta([rec(1, [
      { hero: 'ana', sr: 2500, change: 20 },
      { hero: 'juno', sr: 2400, change: 20 },
    ])], 30)
    expect(got.readCount).toBe(1)
    expect(got.net).toBe(40)
  })

  it('ignores matches outside the window', () => {
    const got = srDelta([rec(1, [{ hero: 'ana', sr: 2500, change: 22 }]), rec(20, [{ hero: 'ana', sr: 2600, change: 30 }])], 3)
    expect(got.net).toBe(30)
  })
})

describe('srVelocity', () => {
  it('reports the rate per week and per session', () => {
    const got = srVelocity([
      rec(1, [{ hero: 'ana', sr: 2500, change: 20 }]),
      rec(2, [{ hero: 'ana', sr: 2520, change: 20 }]),
    ], 14)
    expect(got.perWeek).toBe(20)
    expect(got.readCount).toBe(2)
  })

  it('stays null when nothing was read', () => {
    const got = srVelocity([rec(1), rec(2)], 14)
    expect(got.perWeek).toBeNull()
    expect(got.perSession).toBeNull()
  })
})

describe('srPerRole', () => {
  it('splits the movement by the hero that earned it', () => {
    // SR is per-role in this game, and a support climbing while a tank slides
    // is exactly the thing one number hides.
    const rows = srPerRole([
      rec(1, [{ hero: 'ana', sr: 2500, change: 25 }]),
      rec(2, [{ hero: 'ana', sr: 2525, change: 25 }]),
      rec(3, [{ hero: 'reinhardt', sr: 2100, change: -20 }]),
    ])
    expect(rows).toEqual([
      { hero: 'ana', net: 50, latest: 2525, readCount: 2 },
      { hero: 'reinhardt', net: -20, latest: 2100, readCount: 1 },
    ])
  })

  it('is empty when no match reported SR', () => {
    expect(srPerRole([rec(1), rec(2)])).toEqual([])
  })
})

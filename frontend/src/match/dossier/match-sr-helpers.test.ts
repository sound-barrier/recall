import { describe, it, expect } from 'vitest'
import type { MatchRecord } from '@/api-client'
import { srDelta, srVelocity, srPerHero } from '@/match/dossier/match-sr-helpers'

// SR, as opposed to the meter.
//
// Every climb number the app already shows is denominated in
// `data.change_percent` — the progress meter — because that is what almost
// every rank screen reports. `data.sr[].change` is the real thing and is read
// far less often, so these say "no SR readings" rather than blanking a widget
// that was working.

const day = (n: number) => `2026-08-${String(n).padStart(2, '0')}`

function rec(d: number, sr?: { hero: string; sr: number; change?: number }[]): MatchRecord {
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

  it('treats a hero card with no movement pill as unread, not as flat', () => {
    // The field is optional on the wire precisely so this case exists. It
    // used to arrive as 0 and be counted as a measured flat match.
    const got = srDelta([rec(1, [{ hero: 'ana', sr: 2500 }])], 30)
    expect(got.net).toBeNull()
    expect(got.readCount).toBe(0)
    expect(got.readOf).toBe(1)
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

describe('srPerHero', () => {
  it('splits the movement by the hero that earned it', () => {
    // Overwatch banks SR per hero, and one climbing while another slides is
    // exactly the thing a single net figure hides.
    const rows = srPerHero([
      rec(1, [{ hero: 'ana', sr: 2500, change: 25 }]),
      rec(2, [{ hero: 'ana', sr: 2525, change: 25 }]),
      rec(3, [{ hero: 'reinhardt', sr: 2100, change: -20 }]),
    ])
    expect(rows).toEqual([
      { hero: 'ana', net: 50, latest: 2525, readCount: 2 },
      { hero: 'reinhardt', net: -20, latest: 2100, readCount: 1 },
    ])
  })

  it('keeps the NEWEST reading regardless of how the records arrive', () => {
    // `latest` is the whole point of the row, and "whichever the loop saw
    // last" is not a time. Newest-first input used to invert it silently.
    const rows = srPerHero([
      rec(3, [{ hero: 'ana', sr: 2550, change: 25 }]),
      rec(1, [{ hero: 'ana', sr: 2500, change: 25 }]),
    ])
    expect(rows[0]?.latest).toBe(2550)
  })

  it('does not count a hero the screen merely listed', () => {
    // A rank screen names every hero played; the ones whose movement pill was
    // unreadable carry no change at all. Counting them would grow readCount
    // and pull the net toward a flatness nobody measured.
    const rows = srPerHero([
      rec(1, [{ hero: 'ana', sr: 2500, change: 25 }, { hero: 'lucio', sr: 1896 }]),
    ])
    expect(rows).toEqual([{ hero: 'ana', net: 25, latest: 2500, readCount: 1 }])
  })

  it('lists at most the six heroes with the most readings', () => {
    const heroes = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const rows = srPerHero(heroes.map((hero, i) =>
      rec(i + 1, [{ hero, sr: 2000, change: 10 }])))
    expect(rows).toHaveLength(6)
  })

  it('is empty when no match reported SR', () => {
    expect(srPerHero([rec(1), rec(2)])).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import type { MatchRecord } from '@/api-client'
import { splitByPatch } from '@/match/dossier/match-patch-split'

const PATCHES = [
  { name: 'Season 3', at: '2026-06-16T19:00:00Z', note: 'Season start' },
  { name: 'Season 4', at: '2026-08-11T19:00:00Z', note: 'Season start' },
]

function rec(date: string, result = 'victory'): MatchRecord {
  return {
    match_key: `m-${date}-${result}`,
    data: { date, finished_at: '20:00', result, played_at_utc: `${date}T20:00:00Z` },
  } as unknown as MatchRecord
}

describe('splitByPatch', () => {
  it('compares the window after the newest patch against the one before it', () => {
    const got = splitByPatch([
      rec('2026-08-01', 'victory'), rec('2026-08-02', 'victory'), rec('2026-08-03', 'defeat'),
      rec('2026-08-20', 'defeat'), rec('2026-08-21', 'defeat'),
    ], PATCHES)
    expect(got.patch?.name).toBe('Season 4')
    expect(got.before).toEqual({ winrate: 67, sample: 3 })
    expect(got.after).toEqual({ winrate: 0, sample: 2 })
  })

  it('says which patch it split on, so the number is attributable', () => {
    const got = splitByPatch([rec('2026-08-20')], PATCHES)
    expect(got.patch?.at).toBe('2026-08-11T19:00:00Z')
  })

  it('attributes a one-sided set to the patch it started after', () => {
    // A player whose whole history postdates the newest patch gets an empty
    // "before" attributed to the right patch — not silence, and not a split
    // on last year's patch that would make everything look post-change.
    const got = splitByPatch([rec('2026-08-20'), rec('2026-08-21')], PATCHES)
    expect(got.patch?.name).toBe('Season 4')
    expect(got.before.sample).toBe(0)
    expect(got.after.sample).toBe(2)
  })

  it('places a match by its canonical UTC start, not the local wall clock', () => {
    // The player's naive stamp reads the morning AFTER the boundary; the
    // canonical instant is the evening before it. Season assignment uses the
    // instant, so this must too, or one match sits on both sides of the same
    // boundary in two places in the app.
    const late = {
      match_key: 'm-late',
      data: {
        date: '2026-08-12', finished_at: '08:00', result: 'victory',
        played_at_utc: '2026-08-11T18:30:00Z', game_length: '12:00',
      },
    } as unknown as MatchRecord
    const got = splitByPatch([late, rec('2026-08-20', 'defeat')], PATCHES)
    expect(got.patch?.name).toBe('Season 4')
    expect(got.before.sample).toBe(1)
    expect(got.after.sample).toBe(1)
  })

  it('subtracts the game length so a match that ran past a boundary stays before it', () => {
    // "A match belongs to the patch window its START falls in" — the rule
    // patches.yaml states and season assignment already follows.
    const straddling = {
      match_key: 'm-straddle',
      data: {
        date: '2026-08-11', finished_at: '13:05', result: 'victory',
        played_at_utc: '2026-08-11T19:05:00Z', game_length: '15:00',
      },
    } as unknown as MatchRecord
    const got = splitByPatch([straddling, rec('2026-08-20', 'defeat')], PATCHES)
    expect(got.before.sample).toBe(1)
    expect(got.after.sample).toBe(1)
  })

  it('reports no patch at all when there are none to split on', () => {
    const got = splitByPatch([rec('2026-08-20')], [])
    expect(got.patch).toBeNull()
    expect(got.before.winrate).toBeNull()
    expect(got.after.winrate).toBeNull()
  })

  it('picks the newest patch the set actually straddles', () => {
    // Splitting on a patch every match predates would put the whole history
    // on one side and call it a comparison.
    const got = splitByPatch([rec('2026-06-01'), rec('2026-07-01')], PATCHES)
    expect(got.patch?.name).toBe('Season 3')
    expect(got.before.sample).toBe(1)
    expect(got.after.sample).toBe(1)
  })

  it('ignores draws, like every other win rate here', () => {
    const got = splitByPatch([rec('2026-08-01', 'draw'), rec('2026-08-20', 'victory')], PATCHES)
    expect(got.before.sample).toBe(0)
    expect(got.after.sample).toBe(1)
  })
})

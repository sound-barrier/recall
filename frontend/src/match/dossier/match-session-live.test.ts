import { describe, expect, it } from 'vitest'

import { liveSessionReadout } from '@/match/dossier/match-session-live'
import type { MatchRecord } from '@/api-client'

// The live readout is the session tally joined to WHERE the player is on
// the ladder — which is the half no other session surface carries.

interface Bits {
  day: number
  hh: number
  result?: string
  role?: string
  rank?: { tier: string; level: number; progress?: number }
}

let seq = 0
function rec({ day, hh, result = 'victory', role = 'support', rank }: Bits): MatchRecord {
  seq++
  return {
    match_key: `m${seq}`,
    data: {
      date: `2026-05-${String(day).padStart(2, '0')}`,
      finished_at: `${String(hh).padStart(2, '0')}:00`,
      result,
      role,
      hero: role === 'support' ? 'lucio' : 'genji',
      ...(rank ? { rank: rank.tier, level: rank.level, rank_progress: rank.progress } : {}),
    },
  } as unknown as MatchRecord
}

const at = (day: number, hh: number) => new Date(2026, 4, day, hh, 0).getTime()

describe('liveSessionReadout', () => {
  it('reports nothing when no session is running', () => {
    seq = 0
    expect(liveSessionReadout([rec({ day: 3, hh: 19 })], at(10, 21))).toBeNull()
  })

  it('joins the running session to the rank of the role it is being played in', () => {
    seq = 0
    const readout = liveSessionReadout([
      rec({ day: 10, hh: 19, role: 'dps', rank: { tier: 'silver', level: 1, progress: 10 } }),
      rec({ day: 10, hh: 20, role: 'support', rank: { tier: 'gold', level: 2, progress: 40 } }),
      rec({ day: 10, hh: 21, role: 'support', result: 'defeat', rank: { tier: 'gold', level: 2, progress: 18 } }),
    ], at(10, 21.5 | 0))!

    expect(readout.role).toBe('support')
    expect(readout.rank?.tier).toBe('gold')
    expect(readout.rank?.level).toBe(2)
    expect(readout.rank?.progress).toBe(18)
    expect(readout.summary).toMatchObject({ matches: 3, w: 2, l: 1 })
  })

  it('keeps the tally when the session carries no rank reading at all', () => {
    seq = 0
    const readout = liveSessionReadout([
      rec({ day: 10, hh: 20 }),
      rec({ day: 10, hh: 21, result: 'defeat' }),
    ], at(10, 21))!

    expect(readout.rank).toBeNull()
    expect(readout.summary.matches).toBe(2)
  })

  it('answers for the role of the newest match, not the loudest one', () => {
    seq = 0
    const readout = liveSessionReadout([
      rec({ day: 10, hh: 19, role: 'support', rank: { tier: 'gold', level: 2, progress: 40 } }),
      rec({ day: 10, hh: 20, role: 'support', rank: { tier: 'gold', level: 2, progress: 50 } }),
      rec({ day: 10, hh: 21, role: 'tank', rank: { tier: 'bronze', level: 5, progress: 5 } }),
    ], at(10, 21))!

    expect(readout.role).toBe('tank')
    expect(readout.rank?.tier).toBe('bronze')
  })
})

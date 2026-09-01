import { describe, it, expect } from 'vitest'
import type { MatchRecord } from '@/api-client'
import { queueGapMinutes, freshVsTilted } from '@/match/dossier/match-queue-gap-helpers'

// The gap between one match ENDING and the next BEGINNING.
//
// The app has always BINARIZED this — SESSION_GAP_HOURS turns it into
// "same session or not", breakRust turns it into "rusty or not" — so the size
// of the gap, which is the thing this question is about, was never kept.
//
// Every fixture carries a game_length, because the measurement is only real
// with one: a version that compared finish to finish silently added the whole
// second game to every wait, and with a median match near fourteen minutes,
// "back in the queue within five" became a state the game cannot produce.

// A match that ENDED `minutesAgoFromNoon` after noon UTC and ran `lengthMin`.
function rec(endMinutesFromNoon: number, lengthMin: number, result = 'victory'): MatchRecord {
  const end = new Date(Date.UTC(2026, 7, 1, 12, 0, 0) + endMinutesFromNoon * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    match_key: `m-${endMinutesFromNoon}`,
    data: {
      played_at_utc: end.toISOString(),
      game_length: `${pad(Math.floor(lengthMin))}:${pad(Math.round((lengthMin % 1) * 60))}`,
      result,
    },
  } as unknown as MatchRecord
}

describe('queueGapMinutes', () => {
  it('measures the wait between games, not the span between their endings', () => {
    // Two 14-minute games, the second queued 2 minutes after the first ended.
    // Finish-to-finish would have called that wait 16.
    expect(queueGapMinutes([rec(0, 14), rec(16, 14)])).toEqual([2])
  })

  it('keeps the gap as a number rather than a verdict', () => {
    expect(queueGapMinutes([rec(0, 14), rec(16, 14), rec(90, 14)])).toEqual([2, 60])
  })

  it('reads in time order regardless of how the records arrive', () => {
    expect(queueGapMinutes([rec(90, 14), rec(0, 14), rec(16, 14)])).toEqual([2, 60])
  })

  it('has no gaps for a single match', () => {
    expect(queueGapMinutes([rec(0, 14)])).toEqual([])
  })

  it('skips matches with no placeable time', () => {
    const untimed = { match_key: 'x', data: {} } as unknown as MatchRecord
    expect(queueGapMinutes([rec(0, 14), untimed, rec(16, 14)])).toEqual([2])
  })

  it('drops a negative gap rather than calling it an instant re-queue', () => {
    // Overlapping matches mean the two stamps disagree; a 0-minute wait
    // invented from that is a claim about behavior nobody observed.
    expect(queueGapMinutes([rec(0, 14), rec(5, 14)])).toEqual([])
  })
})

describe('freshVsTilted', () => {
  it('splits the win rate by how long the player waited before queuing', () => {
    // The question this answers: does queuing straight into the next game
    // after a loss cost you, compared with coming back after a break?
    const got = freshVsTilted([
      rec(0, 14, 'victory'),
      rec(16, 14, 'defeat'), // queued 2 min after the last one ended
      rec(32, 14, 'defeat'), // queued 2 min after that
      rec(24 * 60, 14, 'victory'), // a day later — fresh
      rec(24 * 60 + 17, 14, 'victory'), // queued 3 min later
    ])
    expect(got.tilted).toEqual({ winrate: 33, sample: 3 })
    expect(got.fresh).toEqual({ winrate: 100, sample: 1 })
  })

  it('reports no rate rather than zero when a side has nothing in it', () => {
    const got = freshVsTilted([rec(0, 14), rec(16, 14)])
    expect(got.fresh.winrate).toBeNull()
    expect(got.fresh.sample).toBe(0)
  })

  it('leaves out the matches in between, which are neither', () => {
    // A twenty-minute wait is not a re-queue and not a break. Calling it one
    // or the other would put the least meaningful matches on both sides.
    const got = freshVsTilted([rec(0, 14), rec(48, 14, 'defeat')])
    expect(got.tilted.sample).toBe(0)
    expect(got.fresh.sample).toBe(0)
  })

  it('ignores draws, like every other win rate here', () => {
    const got = freshVsTilted([rec(0, 14), rec(17, 14, 'draw')])
    expect(got.tilted.sample).toBe(0)
  })

  it('falls back to the end instant when no game length was captured', () => {
    // Non-SUMMARY captures carry no length. The measurement degrades to
    // finish-to-finish for those rather than dropping them — the coarsest
    // safe placement, the same rule matchStartUTC already follows.
    const noLength = (endMinutesFromNoon: number, result = 'victory') => ({
      match_key: `n-${endMinutesFromNoon}`,
      data: {
        played_at_utc: new Date(Date.UTC(2026, 7, 1, 12, 0, 0) + endMinutesFromNoon * 60_000).toISOString(),
        result,
      },
    } as unknown as MatchRecord)
    const got = freshVsTilted([noLength(0), noLength(3, 'defeat')])
    expect(got.tilted.sample).toBe(1)
  })
})

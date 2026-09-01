import { describe, it, expect } from 'vitest'
import type { MatchRecord } from '@/api-client'
import { queueGapMinutes, freshVsTilted } from '@/match/dossier/match-queue-gap-helpers'

// The gap between one match ending and the next beginning.
//
// The app has always BINARIZED this — SESSION_GAP_HOURS turns it into
// "same session or not", breakRust turns it into "rusty or not" — so the size
// of the gap, which is the thing this question is about, was never kept.

function rec(day: number, hhmm: string, result = 'victory'): MatchRecord {
  return {
    match_key: `m-${day}-${hhmm}`,
    data: { date: `2026-08-${String(day).padStart(2, '0')}`, finished_at: hhmm, result },
  } as unknown as MatchRecord
}

describe('queueGapMinutes', () => {
  it('keeps the gap as a number rather than a verdict', () => {
    const gaps = queueGapMinutes([rec(1, '20:00'), rec(1, '20:12'), rec(1, '21:30')])
    // The first match has nothing before it, so it has no gap.
    expect(gaps).toEqual([12, 78])
  })

  it('reads in time order regardless of how the records arrive', () => {
    const gaps = queueGapMinutes([rec(1, '21:30'), rec(1, '20:00'), rec(1, '20:12')])
    expect(gaps).toEqual([12, 78])
  })

  it('has no gaps for a single match', () => {
    expect(queueGapMinutes([rec(1, '20:00')])).toEqual([])
  })

  it('skips matches with no placeable time', () => {
    const untimed = { match_key: 'x', data: {} } as unknown as MatchRecord
    expect(queueGapMinutes([rec(1, '20:00'), untimed, rec(1, '20:10')])).toEqual([10])
  })
})

describe('freshVsTilted', () => {
  it('splits the win rate by how long the player waited before queuing', () => {
    // The question this answers: does queuing straight into the next game
    // after a loss cost you, compared with coming back after a break?
    const got = freshVsTilted([
      rec(1, '20:00', 'victory'),
      rec(1, '20:04', 'defeat'), // 4 min — a re-queue
      rec(1, '20:08', 'defeat'), // 4 min — a re-queue
      rec(2, '20:00', 'victory'), // a day later — fresh
      rec(2, '20:03', 'victory'), // 3 min — a re-queue
    ])
    expect(got.tilted).toEqual({ winrate: 33, sample: 3 })
    expect(got.fresh).toEqual({ winrate: 100, sample: 1 })
  })

  it('reports no rate rather than zero when a side has nothing in it', () => {
    const got = freshVsTilted([rec(1, '20:00'), rec(1, '20:02')])
    expect(got.fresh.winrate).toBeNull()
    expect(got.fresh.sample).toBe(0)
  })

  it('leaves out the matches in between, which are neither', () => {
    // A twenty-minute gap is not a re-queue and not a break. Calling it one
    // or the other would put the least meaningful matches on both sides.
    const got = freshVsTilted([rec(1, '20:00'), rec(1, '20:20', 'defeat')])
    expect(got.tilted.sample).toBe(0)
    expect(got.fresh.sample).toBe(0)
  })

  it('ignores draws, like every other win rate here', () => {
    const got = freshVsTilted([rec(1, '20:00'), rec(1, '20:03', 'draw')])
    expect(got.tilted.sample).toBe(0)
  })
})

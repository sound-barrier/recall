import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import {
  decisiveResults, afterResultCounts, winrateByStreakDepth, streakMeterImpact,
} from '@/match/elo-streaks'

type Rec = Pick<MatchRecord, 'match_key' | 'data'>

// Chronological result sequence W W L W L L L W, built shuffled to prove
// the helpers sort by match time before walking.
function seqRecords() {
  const seq = ['victory', 'victory', 'defeat', 'victory', 'defeat', 'defeat', 'defeat', 'victory']
  const rows = seq.map((result, i) => ({
    match_key: `m${i}`,
    data: { result, date: `2026-05-0${i + 1}`, finished_at: '12:00' },
  } as Rec))
  return [rows[5]!, rows[0]!, rows[7]!, rows[2]!, rows[4]!, rows[1]!, rows[6]!, rows[3]!]
}

describe('decisiveResults', () => {
  it('returns the chronological win flags, dropping draws and unplaceable rows', () => {
    const rows: Rec[] = [
      ...seqRecords(),
      { match_key: 'draw', data: { result: 'draw', date: '2026-05-09', finished_at: '12:00' } } as Rec,
      { match_key: 'untimed', data: { result: 'victory' } } as Rec,
    ]
    expect(decisiveResults(rows)).toEqual([true, true, false, true, false, false, false, true])
  })
})

describe('afterResultCounts', () => {
  it('tallies the 2×2 next-game table exactly', () => {
    // After a win (i=1,2,4): W, L, L. After a loss (i=3,5,6,7): W, L, L, W.
    expect(afterResultCounts(seqRecords())).toEqual({
      winAfterWin: 1, lossAfterWin: 2, winAfterLoss: 2, lossAfterLoss: 2,
    })
  })
})

describe('winrateByStreakDepth', () => {
  it('buckets next-game win rates by the trailing run length', () => {
    const b = winrateByStreakDepth(seqRecords())
    expect(b.baselineWinrate).toBe(50)
    expect(b.baselineSample).toBe(8)
    // After one loss: i=3 (W), i=5 (L) → 50% of 2. After two: i=6 (L) → 0%
    // of 1. After three or more: i=7 (W) → 100% of 1.
    expect(b.afterLoss).toEqual([
      { depth: 1, winrate: 50, sample: 2 },
      { depth: 2, winrate: 0, sample: 1 },
      { depth: 3, winrate: 100, sample: 1 },
    ])
    // After one win: i=1 (W), i=4 (L) → 50% of 2. After two: i=2 (L) → 0% of 1.
    expect(b.afterWin).toEqual([
      { depth: 1, winrate: 50, sample: 2 },
      { depth: 2, winrate: 0, sample: 1 },
      { depth: 3, winrate: null, sample: 0 },
    ])
  })
})

describe('streakMeterImpact', () => {
  function meterRecords(): Rec[] {
    return [
      { match_key: 'a', data: { change_percent: 20, modifiers: ['victory', 'expected'] } },
      { match_key: 'b', data: { change_percent: -20, modifiers: ['defeat'] } },
      { match_key: 'c', data: { change_percent: 20, modifiers: ['victory'] } },
      { match_key: 'd', data: { change_percent: 30, modifiers: ['victory', 'win streak'] } },
      { match_key: 'e', data: { change_percent: 30, modifiers: ['victory', 'win streak'] } },
      { match_key: 'f', data: { change_percent: -30, modifiers: ['defeat', 'loss streak'] } },
      { match_key: 'g', data: { change_percent: -30, modifiers: ['defeat', 'loss streak'] } },
      // Excluded: calibration reading + an exact zero.
      { match_key: 'h', data: { change_percent: 35, modifiers: ['victory', 'calibration'] } },
      { match_key: 'i', data: { change_percent: 0, modifiers: ['victory'] } },
    ]
  }

  it('splits streak-modified meter moves from normal ones', () => {
    const m = streakMeterImpact(meterRecords())!
    expect(m.normalAbsMean).toBe(20)
    expect(m.normalN).toBe(3)
    expect(m.streakAbsMean).toBe(30)
    expect(m.streakN).toBe(4)
    expect(m.ratio).toBeCloseTo(1.5, 10)
    expect(m.winStreakNet).toBe(60)
    expect(m.lossStreakNet).toBe(-60)
  })

  it('is null until both sides have at least three readings', () => {
    expect(streakMeterImpact(meterRecords().slice(0, 4))).toBeNull()
    expect(streakMeterImpact([])).toBeNull()
  })
})

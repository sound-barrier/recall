import { describe, it, expect } from 'vitest'

import { buildChecks, type MythCheckInputs } from '@/components/elo/elo-myth-checks'

// Wide credible interval (±15 pts) so the rigged card falls through to
// the "too few games" register unless a test narrows it.
const base: MythCheckInputs = {
  percentileTrail: null,
  projInput: { targetScore: 2900, currentScore: 2500 },
  pValue: 0.5,
  sampleN: 40,
  effectiveWinRatePct: 55,
  trueRateRange: { lower: 0.4, upper: 0.7 },
  skepticVerdict: 0.8,
  provisional: false,
  lossStreak: 0.3,
  streakLen: 5,
  streakHorizon: 40,
  runs: { pValue: 0.5, z: 0.3, nWins: 20, nLosses: 20, runs: 21, expectedRuns: 21 },
  probThisSeason: 0.42,
  seasonGames: 120,
  requiredWrForSeason: 0.55,
  decay: { requiredWinRate: null },
  seasonSim: { sims: 20000 },
  simHorizonGames: 120,
  paceAssumed: false,
  rankNow: 'Gold 3',
  target: 'Platinum 5',
}

describe('buildChecks', () => {
  it('returns nothing without projection inputs', () => {
    expect(buildChecks({ ...base, projInput: null })).toEqual([])
  })

  it('emits the cards in fixed order and drops each behind its own gate', () => {
    expect(buildChecks(base).map((c) => c.id)).toEqual(
      ['rigged', 'skeptic', 'streaks', 'scripted', 'season'])
    const gated = buildChecks({
      ...base, pValue: null, skepticVerdict: null, lossStreak: null, runs: null,
    })
    expect(gated.map((c) => c.id)).toEqual(['season'])
  })

  describe('rigged card', () => {
    it('celebrates a significant rate only when it is good news', () => {
      const good = buildChecks({ ...base, pValue: 0.01, effectiveWinRatePct: 55 })[0]!
      expect(good).toMatchObject({ id: 'rigged', a: 'No — that rate is real', tone: 'good' })
      const bad = buildChecks({ ...base, pValue: 0.01, effectiveWinRatePct: 45 })[0]!
      expect(bad.tone).toBe('neutral')
      expect(bad.note).toContain("It's really yours")
    })

    it('reads a tightly pinned near-even rate as an answer, not a shrug', () => {
      const c = buildChecks({
        ...base, trueRateRange: { lower: 0.47, upper: 0.55 }, effectiveWinRatePct: 51,
      })[0]!
      expect(c).toMatchObject({ a: 'No — near even, measured well', tone: 'good' })
      expect(c.note).toContain('47–55%')
      expect(c.note).toContain('a shade above even')
      expect(c.note).toContain('A slow climb looks exactly like this.')
    })

    it('marks a pinned below-even lean as a real dip', () => {
      const c = buildChecks({
        ...base, trueRateRange: { lower: 0.42, upper: 0.5 }, effectiveWinRatePct: 46,
      })[0]!
      expect(c).toMatchObject({ a: 'No — a real dip, not a rigging', tone: 'warn' })
    })

    it('admits when the sample is too thin to say anything', () => {
      expect(buildChecks(base)[0]!.a).toBe('Too few games to tell')
    })
  })

  it('grades loss-streak odds across the normal / rare / never registers', () => {
    const streakOf = (lossStreak: number) =>
      buildChecks({ ...base, lossStreak }).find((c) => c.id === 'streaks')!
    expect(streakOf(0.3).a).toContain('— normal')
    expect(streakOf(0.01).a).toContain('— rare, but real')
    expect(streakOf(0.001).a).toBe('Effectively never at this rate')
  })

  it('answers scripted-streaks from the runs test direction', () => {
    const streaky = buildChecks({
      ...base, runs: { ...base.runs!, pValue: 0.01, z: -2 },
    }).find((c) => c.id === 'scripted')!
    expect(streaky).toMatchObject({ a: 'Streakier than chance', tone: 'neutral' })
    const coinLike = buildChecks(base).find((c) => c.id === 'scripted')!
    expect(coinLike).toMatchObject({ a: 'Coin-like — nothing scripted', tone: 'good' })
  })


  describe('season card', () => {
    it('quotes the simulator when it ran', () => {
      const c = buildChecks(base).find((c) => c.id === 'season')!
      expect(c.note).toContain('20,000 times')
      expect(c.note).toContain('at your pace')
    })

    it('falls back to the capped closed form when the sim is unavailable', () => {
      const c = buildChecks({ ...base, seasonSim: null, probThisSeason: null })
        .find((c) => c.id === 'season')!
      expect(c.a).toBe('Not at this rate')
      expect(c.note).toContain('55.0%')
    })

    it('emits nothing when the target is not above the current score', () => {
      expect(buildChecks({
        ...base, seasonSim: null, probThisSeason: null,
        projInput: { targetScore: 2500, currentScore: 2500 },
      }).find((c) => c.id === 'season')).toBeUndefined()
    })
  })
})

// The population card deleted in a928122f answered "where do I stand" from a
// published distribution that season 4's Rank Redistribution voided. Its
// successor answers from the player's own screenshots, so it needs no
// distribution — and it must never re-acquire one by implication.
describe('standing', () => {
  const trail = (over: Partial<NonNullable<MythCheckInputs['percentileTrail']>> = {}) =>
    ({ now: 61, nowRank: 'Platinum 2', previous: 52, deltaPts: 9, comparableN: 3, n: 3, ...over })

  it('is absent when no capture reported a percentile', () => {
    expect(buildChecks({ ...base, percentileTrail: null }).find((c) => c.id === 'standing'))
      .toBeUndefined()
  })

  it('states the movement when two same-season readings pair', () => {
    const c = buildChecks({ ...base, percentileTrail: trail() }).find((x) => x.id === 'standing')

    expect(c?.a).toContain('61%')
    expect(c?.note).toContain('up 9 pts')
    expect(c?.note).toContain('52%')
    expect(c?.tone).toBe('good')
  })

  it('reads a decline as a decline', () => {
    const c = buildChecks({ ...base, percentileTrail: trail({ now: 44, previous: 52, deltaPts: -8 }) })
      .find((x) => x.id === 'standing')

    expect(c?.note).toContain('down 8 pts')
    expect(c?.tone).toBe('bad')
  })

  // One reading is the COMMON case, since only post-placement screens carry the
  // caption. The fact still stands; only the comparison is missing.
  it('states the bare standing when there is nothing to pair', () => {
    const c = buildChecks({ ...base, percentileTrail: trail({ previous: null, deltaPts: null, n: 1 }) })
      .find((x) => x.id === 'standing')

    expect(c?.a).toContain('61%')
    expect(c?.note).toMatch(/nothing to compare/i)
    expect(c?.note).not.toMatch(/up \d|down \d/)
  })

  // The word carried a DIAGNOSIS the number cannot support on its own.
  it('never calls the player hardstuck', () => {
    for (const t of [trail(), trail({ previous: null, deltaPts: null, n: 1 })]) {
      const c = buildChecks({ ...base, percentileTrail: t }).find((x) => x.id === 'standing')
      expect(`${c?.q} ${c?.a} ${c?.note}`.toLowerCase()).not.toContain('hardstuck')
    }
  })
})

// Three findings the Phase 2 review confirmed, each about the card claiming
// more than its data supports.
describe('standing — what the card is entitled to say', () => {
  const trail = (over: Record<string, unknown> = {}) =>
    ({ now: 61, nowRank: 'Platinum 2', previous: 52, deltaPts: 9, comparableN: 3, n: 3, ...over }) as NonNullable<MythCheckInputs['percentileTrail']>

  // A percentile is a statement about a SPECIFIC rank. The latest capture
  // carrying a caption can be older than the latest rank reading, so quoting
  // the number beside the calculator's current rank would attach it to a rank
  // it was never measured at.
  it('names the rank the reading was printed against, not the current one', () => {
    const c = buildChecks({
      ...base, rankNow: 'Diamond 4', percentileTrail: trail({ nowRank: 'Platinum 2', previous: null, deltaPts: null, n: 1, comparableN: 1 }),
    }).find((x) => x.id === 'standing')

    expect(c?.note).toContain('Platinum 2')
    expect(c?.note).not.toContain('Diamond 4')
  })

  // "One reading so far" is false when there are five of them and the earlier
  // four simply sit in a previous season.
  it('says why several readings still cannot be compared', () => {
    const c = buildChecks({
      ...base, percentileTrail: trail({ previous: null, deltaPts: null, n: 5, comparableN: 1 }),
    }).find((x) => x.id === 'standing')

    expect(c?.note).toContain('5 readings')
    expect(c?.note).toMatch(/previous seasons/i)
    expect(c?.note).not.toMatch(/one reading so far/i)
  })

  // Counting readings it refused to compare advertises a sample it did not use.
  it('counts only the readings inside the compared season', () => {
    const c = buildChecks({
      ...base, percentileTrail: trail({ n: 9, comparableN: 3 }),
    }).find((x) => x.id === 'standing')

    expect(c?.note).toContain('across 3 readings')
    expect(c?.note).not.toContain('across 9 readings')
  })
})

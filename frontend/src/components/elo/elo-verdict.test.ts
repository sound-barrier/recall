import { describe, it, expect } from 'vitest'

import { deriveVerdict, type VerdictInput } from '@/components/elo/elo-verdict'
import { PROVISIONAL_MIN_DECISIVE } from '@/match/elo-model'

function input(over: Partial<VerdictInput> = {}): VerdictInput {
  return {
    target: 'Platinum 5',
    winRatePct: 55,
    n: 60,
    isEdited: false,
    alreadyThere: false,
    requiredWinRate: null,
    expectedGamesDecay: 90,
    ceiling: { lo: 15.2, hi: 18.1 },
    targetScoreLadder: 20,
    sim: { probReachTarget: 0.47, probEndLower: 0.22, gamesToTargetP50: 96, sims: 4000 },
    horizonGames: 120,
    paceAssumed: false,
    gamesPerWeek: 10,
    ...over,
  }
}

describe('deriveVerdict', () => {
  it('already-there wins over everything', () => {
    const v = deriveVerdict(input({ alreadyThere: true, n: 1 }))
    expect(v.eyebrow).toBe("You're there")
    expect(v.tone).toBe('is-good')
  })

  it('THE regression: a 1W-2L record is an Early read, never Capped', () => {
    const v = deriveVerdict(input({
      n: 3, winRatePct: 33.3, requiredWinRate: 0.573,
      ceiling: { lo: 2.1, hi: 21.4 },
      sim: { probReachTarget: 0.01, probEndLower: 0.21, gamesToTargetP50: null, sims: 4000 },
    }))
    expect(v.tone).toBe('is-early')
    expect(v.eyebrow).toContain('Early read — only 3 decisive games')
    expect(v.head).toBe('Too early to call')
    expect(v.sub).toContain('1% of simulated seasons')
    expect(v.sub).toContain('read this as a sketch')
    expect(v.sub).not.toContain('Reality check')
    expect(v.sub).not.toContain('Capped')
  })

  it('an early read with strong sim odds says reachable, still hedged', () => {
    const v = deriveVerdict(input({
      n: 10, winRatePct: 70, requiredWinRate: null,
      sim: { probReachTarget: 0.83, probEndLower: 0.05, gamesToTargetP50: 30, sims: 4000 },
    }))
    expect(v.tone).toBe('is-early')
    expect(v.head).toBe('Platinum 5 looks reachable')
    expect(v.sub).toContain('83% of simulated seasons')
  })

  it('the floor is exactly PROVISIONAL_MIN_DECISIVE', () => {
    expect(deriveVerdict(input({ n: PROVISIONAL_MIN_DECISIVE - 1 })).tone).toBe('is-early')
    expect(deriveVerdict(input({ n: PROVISIONAL_MIN_DECISIVE })).tone).not.toBe('is-early')
  })

  it('capped quotes the sim, the ceiling RANGE, and the asymptote as HOLDING', () => {
    const v = deriveVerdict(input({
      requiredWinRate: 0.575, winRatePct: 55,
      ceiling: { lo: 13.9, hi: 14.6 },
      sim: { probReachTarget: 0.06, probEndLower: 0.62, gamesToTargetP50: null, sims: 4000 },
    }))
    expect(v.tone).toBe('is-hard')
    expect(v.eyebrow).toBe('Reality check')
    expect(v.head).toContain('Capped near')
    expect(v.head).toContain('–') // a range, not a point
    expect(v.sub).toContain('6% of simulated seasons touch Platinum 5')
    expect(v.sub).toContain('Holding Platinum 5 would take about 57.5%')
    expect(v.sub).not.toContain('climb past it')
  })

  it('reachable leads with the median simulated season and discloses the spread', () => {
    const v = deriveVerdict(input({}))
    expect(v.eyebrow).toBe('If your form holds')
    expect(v.head).toBe('~96 games')
    expect(v.sub).toContain('47% of simulated seasons')
    expect(v.sub).toContain('22% end lower than today')
    expect(v.sub).toContain('underranked, not hardstuck')
  })

  it('edits mark the eyebrow on every branch', () => {
    expect(deriveVerdict(input({ isEdited: true })).eyebrow).toBe('If your edits hold')
    expect(deriveVerdict(input({ isEdited: true, requiredWinRate: 0.6 })).eyebrow).toBe('Reality check — for your edits')
    expect(deriveVerdict(input({ isEdited: true, n: 3 })).eyebrow).toContain('— for your edits')
  })

  it('an open-top ceiling gets its own honest tail instead of a garbled range', () => {
    const v = deriveVerdict(input({ n: 25, ceiling: { lo: 16.4, hi: null } }))
    expect(v.sub).toContain('no hard ceiling yet')
    expect(v.sub).not.toContain('or higher — no hard ceiling is detectable yet, past')
  })

  it('the weeks label prices the SAME games number as the headline', () => {
    // p50 = 96 at 10 games/week → ≈ 10 weeks; a naive-model label here
    // once printed weeks that contradicted the head by 2x near a plateau.
    const v = deriveVerdict(input({}))
    expect(v.sub).toContain('≈ 9.6 weeks')
    const slow = deriveVerdict(input({
      sim: { probReachTarget: 0.6, probEndLower: 0.2, gamesToTargetP50: 200, sims: 4000 },
    }))
    expect(slow.sub).toContain('≈ 20 weeks')
  })

  it('a ceiling range straddling the target reads borderline, not capped', () => {
    const v = deriveVerdict(input({
      requiredWinRate: 0.56, targetScoreLadder: 17, ceiling: { lo: 15.5, hi: 18.2 },
      sim: { probReachTarget: 0.4, probEndLower: 0.35, gamesToTargetP50: null, sims: 4000 },
    }))
    expect(v.head).toBe('Platinum 5 is borderline')
    expect(v.sub).toContain('straddles Platinum 5')
    expect(v.sub).not.toContain('short of Platinum 5.')
  })

  it('an open-top slope CI softens the capped claim — never "Capped" + "no ceiling"', () => {
    // The measured slope's own CI admits an improver: asserting a cap while
    // admitting no ceiling is detectable contradicts itself in one line.
    const v = deriveVerdict(input({
      requiredWinRate: 0.575, ceiling: { lo: 0, hi: null },
      sim: { probReachTarget: 0.34, probEndLower: 0.3, gamesToTargetP50: null, sims: 4000 },
    }))
    expect(v.head).not.toContain('Capped')
    expect(v.head).toContain('Short of Platinum 5')
    expect(v.sub).toContain('no hard ceiling is detectable yet')
    expect(v.sub).toContain('34% of simulated seasons')
  })

  it('a swallowed sim median never masquerades as one', () => {
    // reach < 50% ⇒ the median season doesn't arrive; the head falls back
    // to the decay expectation and the copy must say so, not claim the
    // median simulated season got there.
    const v = deriveVerdict(input({
      expectedGamesDecay: 257,
      sim: { probReachTarget: 0.41, probEndLower: 0.31, gamesToTargetP50: null, sims: 4000 },
    }))
    expect(v.head).toBe('~257 games')
    expect(v.sub).not.toContain('median simulated season')
    expect(v.sub).toContain('Only 41% of simulated seasons get there within ~120 games')
  })

  it('an assumed pace is disclosed wherever the sim is quoted', () => {
    const v = deriveVerdict(input({ paceAssumed: true }))
    expect(v.sub).toContain('assuming ~10 games a week')
  })
})

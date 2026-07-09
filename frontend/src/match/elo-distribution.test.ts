import { describe, it, expect } from 'vitest'

import { RANK_DISTRIBUTION_JULY_2025, populationPercentile } from '@/match/elo-distribution'

describe('RANK_DISTRIBUTION_JULY_2025', () => {
  it('covers the whole ladder and sums to 100%', () => {
    const total = RANK_DISTRIBUTION_JULY_2025.reduce((s, b) => s + b.share, 0)
    expect(total).toBeCloseTo(100, 9)
    const span = RANK_DISTRIBUTION_JULY_2025.reduce((s, b) => s + b.width, 0)
    expect(span).toBe(40)
  })
})

describe('populationPercentile', () => {
  it('hits the published cumulative shares at every tier boundary', () => {
    expect(populationPercentile(0)).toBe(0)
    expect(populationPercentile(5)).toBeCloseTo(2.4, 9) // top of Bronze
    expect(populationPercentile(10)).toBeCloseTo(15.0, 9) // + Silver
    expect(populationPercentile(15)).toBeCloseTo(46.7, 9) // + Gold
    expect(populationPercentile(20)).toBeCloseTo(81.6, 9) // + Platinum
    expect(populationPercentile(25)).toBeCloseTo(96.5, 9) // + Diamond
    expect(populationPercentile(30)).toBeCloseTo(99.7, 9) // + Master
    expect(populationPercentile(40)).toBe(100)
  })

  it('interpolates linearly inside a band', () => {
    // Mid-Gold: 15.0 + 31.7/2 = 30.85.
    expect(populationPercentile(12.5)).toBeCloseTo(30.85, 9)
    // Mid-GM+Champion (a 10-unit combined band): 99.7 + 0.3/2 = 99.85.
    expect(populationPercentile(35)).toBeCloseTo(99.85, 9)
  })

  it('clamps outside the ladder', () => {
    expect(populationPercentile(-3)).toBe(0)
    expect(populationPercentile(55)).toBe(100)
  })
})

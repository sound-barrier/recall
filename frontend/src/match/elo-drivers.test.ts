import { describe, it, expect } from 'vitest'

import { statSeparators } from '@/match/elo-drivers'

// Five wins with low deaths / high healing, five losses with the reverse —
// deterministic values so the means, effect size, and Welch p are exact.
function corpus() {
  const rows: { data: Record<string, unknown> }[] = []
  const winDeaths = [4, 4, 5, 4, 5]
  const lossDeaths = [6, 7, 6, 7, 6]
  for (let i = 0; i < 5; i++) {
    rows.push({
      data: {
        result: 'victory', game_length: '10:00', healing: 9000 + i * 100,
        performance: { deaths: { total: 5, avg_per_10min: winDeaths[i] } },
      },
    })
    rows.push({
      data: {
        result: 'defeat', game_length: '10:00', healing: 7000 + i * 100,
        performance: { deaths: { total: 7, avg_per_10min: lossDeaths[i] } },
      },
    })
  }
  return rows
}

describe('statSeparators', () => {
  it('computes exact means, effect size, and Welch p for the deaths split', () => {
    const deaths = statSeparators(corpus()).find((s) => s.key === 'deaths')!
    expect(deaths.winMean).toBeCloseTo(4.4, 10)
    expect(deaths.lossMean).toBeCloseTo(6.4, 10)
    expect(deaths.nWins).toBe(5)
    expect(deaths.nLosses).toBe(5)
    expect(deaths.betterWhen).toBe('lower')
    // Pooled SD = √0.3 → d = −2/0.5477 = −3.6515.
    expect(deaths.effect).toBeCloseTo(-3.6515, 3)
    // Welch t = −5.7735 at df = 8 → p ≈ 0.0004.
    expect(deaths.pValue).not.toBeNull()
    expect(deaths.pValue!).toBeLessThan(0.001)
  })

  it('normalizes raw totals per 10 minutes via the game length', () => {
    const healing = statSeparators(corpus()).find((s) => s.key === 'healing')!
    // 10-minute games → per-10 equals the total.
    expect(healing.winMean).toBeCloseTo(9200, 6)
    expect(healing.lossMean).toBeCloseTo(7200, 6)
    expect(healing.betterWhen).toBe('higher')
  })

  it('scales a shorter game up to the per-10 rate', () => {
    const rows = corpus()
    rows.push({ data: { result: 'victory', game_length: '05:00', healing: 5000 } })
    const healing = statSeparators(rows).find((s) => s.key === 'healing')!
    // The extra win contributes 5000/5·10 = 10000: mean (9000+…+9400+10000)/6.
    expect(healing.winMean).toBeCloseTo((9000 + 9100 + 9200 + 9300 + 9400 + 10000) / 6, 6)
  })

  it('sorts by effect magnitude and drops stats below the per-arm floor', () => {
    const out = statSeparators(corpus())
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs(out[i - 1]!.effect)).toBeGreaterThanOrEqual(Math.abs(out[i]!.effect))
    }
    // Eliminations were never provided → no row for them.
    expect(out.some((s) => s.key === 'eliminations')).toBe(false)
    // Damage present on only two wins → below the 5-per-arm floor → dropped.
    const sparse = corpus()
    sparse[0]!.data.damage = 9000
    sparse[2]!.data.damage = 9500
    expect(statSeparators(sparse).some((s) => s.key === 'damage')).toBe(false)
  })

  it('drops a stat whose values are identical everywhere (no information)', () => {
    const rows = corpus().map((r) => ({ data: { ...r.data, mitigation: 1000 } }))
    expect(statSeparators(rows).some((s) => s.key === 'mitigation')).toBe(false)
  })
})

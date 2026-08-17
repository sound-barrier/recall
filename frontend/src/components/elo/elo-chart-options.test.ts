import { LADDER_MAX } from '@/match/elo/elo-model'

import { describe, it, expect, afterEach } from 'vitest'

import { buildEloProjectionOption, buildSkillCurveOption } from '@/components/elo/elo-chart-options'
import type { ProjectionCurves } from '@/match/elo/elo-model'
import type { SeasonSim } from '@/match/elo/elo-simulate'
import type { SkillCurve } from '@/match/elo/elo-kalman'

const CURVES: ProjectionCurves = {
  games: [0, 10, 20],
  naive: [13.4, 14.2, 15],
  decay: [13.4, 13.7, 13.9],
  bandLow: [13.4, 13.4, 13.4],
  bandHigh: [13.4, 15, 16.6],
  horizonGames: 20,
}

interface ChartSeries {
  name?: string
  markLine?: unknown
  markArea?: unknown
  data?: unknown
}

function seriesByName(
  option: ReturnType<typeof buildEloProjectionOption>,
  name: string,
): ChartSeries | undefined {
  return (option.series as ChartSeries[]).find((s) => s.name === name)
}

describe('buildEloProjectionOption', () => {
  it('emits the two futures plus a silent luck band, with the target markline', () => {
    const option = buildEloProjectionOption(CURVES, { targetScore: 15, targetLabel: 'Platinum 5' })
    const names = (option.series as { name?: string }[]).map((s) => s.name)
    expect(names).toEqual(['band-base', 'band-spread', 'If your wins hold', 'As opponents get tougher'])

    const dream = seriesByName(option, 'If your wins hold')
    expect(dream?.markLine).toBeTruthy() // target line lives on the optimistic series
    // No ceiling line unless one is requested.
    expect(seriesByName(option, 'As opponents get tougher')?.markLine).toBeUndefined()
  })

  it('draws a "your ceiling now" line when the target is above the plateau', () => {
    const option = buildEloProjectionOption(CURVES, {
      targetScore: 15, targetLabel: 'Platinum 5', ceilingScore: 13.9,
    })
    expect(seriesByName(option, 'As opponents get tougher')?.markLine).toBeTruthy()
  })

  it('caps the y-axis to the ladder and labels tiers on the fives', () => {
    const option = buildEloProjectionOption(CURVES, { targetScore: 15, targetLabel: 'Platinum 5' })
    const yAxis = option.yAxis as { max: number; axisLabel: { formatter: (v: number) => string } }
    expect(yAxis.max).toBeLessThanOrEqual(40)
    expect(yAxis.axisLabel.formatter(10)).toBe('Gold')
    expect(yAxis.axisLabel.formatter(12)).toBe('') // only labels multiples of 5
  })

  it('renders a plain-language axis tooltip from the model rows', () => {
    const option = buildEloProjectionOption(CURVES, { targetScore: 15, targetLabel: 'Platinum 5' })
    const fmt = (option.tooltip as { formatter: (p: unknown) => string }).formatter
    const html = fmt([
      { seriesName: 'If your wins hold', value: [10, 14.2] },
      { seriesName: 'As opponents get tougher', value: [10, 13.7] },
    ])
    expect(html).toContain('After 10 games')
    expect(html).toContain('If your wins hold: Gold')
    expect(fmt([])).toBe('') // nothing to show
  })

  it('keeps the tooltip on the ladder for scores past either end of it', () => {
    const option = buildEloProjectionOption(CURVES, { targetScore: 15, targetLabel: 'Platinum 5' })
    const fmt = (option.tooltip as { formatter: (p: unknown) => string }).formatter
    expect(fmt([{ seriesName: 'If your wins hold', value: [10, 45] }])).toContain('Champion 1')
    expect(fmt([{ seriesName: 'If your wins hold', value: [10, -3] }])).toContain('Bronze 5')
    // A band row alone is background, not an answer.
    expect(fmt([{ seriesName: 'band-spread', value: [10, 14] }])).toBe('')
  })
})

// ─── The simulator's envelope and the ceiling band ──────────────────
//
// Both are drawn as SILENT background: the fan is the season simulator's
// 10–90% spread, the ceiling band the credible range around the plateau.
// Each is optional, and each has a suppression rule.
describe('buildEloProjectionOption — optional bands', () => {
  const FAN: SeasonSim['fan'] = {
    games: [0, 25, 50],
    p10: [13, 13.5, 14],
    p50: [13, 14, 15.5],
    p90: [13, 14.5, 17],
  }

  it('stacks the simulated fan behind the model curves and lists it in the legend', () => {
    const option = buildEloProjectionOption(CURVES, { targetScore: 15, targetLabel: 'Platinum 5', fan: FAN })
    expect((option.series as ChartSeries[]).map((s) => s.name)).toEqual([
      'sim-base', 'Simulated range', 'band-base', 'band-spread', 'If your wins hold', 'As opponents get tougher',
    ])
    expect((option.legend as { data: string[] }).data).toContain('Simulated range')
    // The visible band is the p10 base plus a stacked p90−p10 spread.
    expect(seriesByName(option, 'sim-base')?.data).toEqual([[0, 13], [25, 13.5], [50, 14]])
    expect(seriesByName(option, 'Simulated range')?.data).toEqual([[0, 0], [25, 1], [50, 3]])
  })

  it('widens the x-axis to whichever runs longer, the fan or the model horizon', () => {
    const withFan = buildEloProjectionOption(CURVES, { targetScore: 15, targetLabel: 'Platinum 5', fan: FAN })
    expect((withFan.xAxis as { max: number }).max).toBe(50) // fan outruns the 20-game horizon
    const without = buildEloProjectionOption(CURVES, { targetScore: 15, targetLabel: 'Platinum 5' })
    expect((without.xAxis as { max: number }).max).toBe(20)
    expect((without.legend as { data: string[] }).data).not.toContain('Simulated range')
  })

  it('shades the ceiling range but keeps only the line when the range is degenerate', () => {
    const base = { targetScore: 15, targetLabel: 'Platinum 5', ceilingScore: 13.9 }
    const shaded = buildEloProjectionOption(CURVES, { ...base, ceilingBand: { lo: 12, hi: 15 } })
    expect(seriesByName(shaded, 'As opponents get tougher')?.markArea).toBeTruthy()

    const degenerate = buildEloProjectionOption(CURVES, { ...base, ceilingBand: { lo: 13.9, hi: 13.9 } })
    expect(seriesByName(degenerate, 'As opponents get tougher')?.markArea).toBeUndefined()
    expect(seriesByName(degenerate, 'As opponents get tougher')?.markLine).toBeTruthy()
  })
})

// ─── The Kalman "true skill" curve ─────────────────────────────────
describe('buildSkillCurveOption', () => {
  // A reading mid-ladder, one whose band runs off the top, and one whose
  // band runs off the bottom — the two clamps in one curve.
  const CURVE: SkillCurve = {
    t: [1000, 2000, 3000],
    // The middle sample sits half a division under the ladder ceiling so the
    // +halfWidth genuinely overshoots and the clamp is exercised. Derived —
    // it was a literal 39.5, which stopped touching the top the moment a
    // tier was inserted and quietly retired the assertion below.
    level: [12, LADDER_MAX - 0.5, 0.25],
    halfWidth: [0.5, 2, 1],
    q: 0.1,
    r: 0.2,
    signalShare: 0.5,
    saturated: false,
    n: 3,
  }

  function skillSeries(option: ReturnType<typeof buildSkillCurveOption>, name: string): ChartSeries | undefined {
    return (option.series as ChartSeries[]).find((s) => s.name === name)
  }

  it('clamps the uncertainty band to the ladder and stacks it under the line', () => {
    const option = buildSkillCurveOption(CURVE)
    expect((option.series as ChartSeries[]).map((s) => s.name))
      .toEqual(['skill-band-base', 'skill-band-spread', 'True skill'])
    // Top tier + 2 is still the top tier; Bronze 5 − 1 is still Bronze 5.
    expect(skillSeries(option, 'skill-band-base')?.data).toEqual([[1000, 11.5], [2000, LADDER_MAX - 2.5], [3000, 0]])
    expect(skillSeries(option, 'skill-band-spread')?.data).toEqual([[1000, 1], [2000, 2.5], [3000, 1.25]])
    expect(skillSeries(option, 'True skill')?.data).toEqual([[1000, 12], [2000, LADDER_MAX - 0.5], [3000, 0.25]])
  })

  it('sizes the y-axis to the band, never past the ladder', () => {
    const yAxis = buildSkillCurveOption(CURVE).yAxis as {
      min: number
      max: number
      axisLabel: { formatter: (v: number) => string }
    }
    expect(yAxis.min).toBe(0)
    expect(yAxis.max).toBe(LADDER_MAX)
    expect(yAxis.axisLabel.formatter(15)).toBe('Platinum')
    expect(yAxis.axisLabel.formatter(3)).toBe('') // only labels multiples of 5
  })

  it('marks a detected shift on the line, and nothing without one', () => {
    expect(skillSeries(buildSkillCurveOption(CURVE, { breakAt: 2000 }), 'True skill')?.markLine).toBeTruthy()
    expect(skillSeries(buildSkillCurveOption(CURVE), 'True skill')?.markLine).toBeUndefined()
  })

  it('names the rank in the tooltip, and stays silent for the band rows', () => {
    const fmt = (buildSkillCurveOption(CURVE).tooltip as { formatter: (p: unknown) => string }).formatter
    expect(fmt([{ seriesName: 'True skill', value: [1000, 12] }])).toContain('True skill: Gold 3')
    expect(fmt([{ seriesName: 'skill-band-spread', value: [1000, 1] }])).toBe('')
  })
})

// ─── Series colors follow the palette ──────────────────────────────
//
// The dream/reality/skill hues were module constants (`#5ca8ff`,
// `#f5a623`, `#8bc7a0`), duplicating the values styles/elo.css held as
// --elo-dream / --elo-reality. Two copies of the same intent in two
// languages drift, and neither followed the theme — on Day the card
// border resolved dark while the chart line beside it stayed light.
// Both sides now resolve the same palette tokens.
describe('elo-chart-options — series colors resolve from palette tokens', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style')
  })

  function seriesNamed(name: string): { color?: unknown } | undefined {
    const opt = buildEloProjectionOption(CURVES, { targetScore: 20, targetLabel: 'Plat 1' })
    const series = opt.series as { name?: string; color?: unknown }[] | undefined
    return series?.find((s) => s.name === name)
  }

  it('draws the optimistic future in --tank', () => {
    document.documentElement.style.setProperty('--tank', '#1f5491')
    expect(seriesNamed('If your wins hold')?.color).toBe('#1f5491')
  })

  it('draws the pessimistic future in --accent', () => {
    document.documentElement.style.setProperty('--accent', '#fa9c1b')
    expect(seriesNamed('As opponents get tougher')?.color).toBe('#fa9c1b')
  })

  it('rebuilds with the new hue after a palette change', () => {
    document.documentElement.style.setProperty('--tank', '#1f5491')
    const day = seriesNamed('If your wins hold')?.color
    document.documentElement.style.setProperty('--tank', '#6ab8ff')
    expect(seriesNamed('If your wins hold')?.color).not.toBe(day)
  })
})

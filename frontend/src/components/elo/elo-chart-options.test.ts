import { describe, it, expect, afterEach } from 'vitest'

import { buildEloProjectionOption } from '@/components/elo/elo-chart-options'
import type { ProjectionCurves } from '@/match/elo-model'

const CURVES: ProjectionCurves = {
  games: [0, 10, 20],
  naive: [13.4, 14.2, 15],
  decay: [13.4, 13.7, 13.9],
  bandLow: [13.4, 13.4, 13.4],
  bandHigh: [13.4, 15, 16.6],
  horizonGames: 20,
}

function seriesByName(option: ReturnType<typeof buildEloProjectionOption>, name: string) {
  return (option.series as { name?: string; markLine?: unknown }[]).find((s) => s.name === name)
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

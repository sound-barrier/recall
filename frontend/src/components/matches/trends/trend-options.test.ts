import { describe, it, expect } from 'vitest'

import { rankLadderOption, winrateOption, lineOption, rankDeltaOption } from '@/components/matches/trends/trend-options'
import type { RankSeries, TrendSeries } from '@/match/match-trends-helpers'

// The shared INTERACTION spreads a bottom zoom/pan slider into every
// TIMELINE chart. Narrow the dataZoom union down to the slider shape the
// assertions read.
interface SliderZoom {
  type?: string
  handleLabel?: { show?: boolean }
}

function sliderZoom(opt: { dataZoom?: unknown }): SliderZoom | undefined {
  const zooms = opt.dataZoom as SliderZoom[] | undefined
  return zooms?.find((z) => z.type === 'slider')
}

describe('trend-options — shared timeline interaction', () => {
  // Each timeline builder spreads the shared INTERACTION regardless of its
  // series, so an empty input still yields the slider config.
  const timelineBuilders: Record<string, () => { dataZoom?: unknown }> = {
    'rank ladder': () => rankLadderOption([]),
    'rolling win-rate': () => winrateOption([]),
    'generic line': () => lineOption([]),
    'rank delta': () => rankDeltaOption([]),
  }

  // echarts 6.1's dataZoom.handleLabel: the slider only labels its handles
  // on hover by default; we turn it always-on so dragging the zoom shows the
  // date at each end. This is the observable contract of Part A's cheap win.
  for (const [name, build] of Object.entries(timelineBuilders)) {
    it(`${name}: the zoom slider labels its handles`, () => {
      const slider = sliderZoom(build())
      expect(slider).toBeDefined()
      expect(slider?.handleLabel?.show).toBe(true)
    })
  }
})

function firstSeriesAreaStyle(opt: { series?: unknown }): unknown {
  const series = opt.series as { areaStyle?: unknown }[] | undefined
  return series?.[0]?.areaStyle
}

describe('trend-options — area fill (climb feel)', () => {
  const rankSeries: RankSeries[] = [
    { key: 'tank', label: 'Tank', points: [{ t: 1, score: 10, tier: 'gold', level: 3, progress: 0, change: 0, matchKey: 'm1' }] },
  ]
  const netSeries: TrendSeries[] = [{ name: 'Tank', key: 'tank', points: [{ t: 1, v: 5, matchKey: 'm1' }] }]

  it('the rank ladder fills the area under each line', () => {
    expect(firstSeriesAreaStyle(rankLadderOption(rankSeries))).toBeDefined()
  })

  // lineOption backs three charts (combat, cumulative-net, modifiers); only
  // cumulative-net opts into the fill, so the fill is behind a flag.
  it('lineOption fills the area only when asked', () => {
    expect(firstSeriesAreaStyle(lineOption(netSeries, { area: true }))).toBeDefined()
    expect(firstSeriesAreaStyle(lineOption(netSeries))).toBeUndefined()
  })
})

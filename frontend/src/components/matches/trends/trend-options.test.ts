import { describe, it, expect, afterEach } from 'vitest'

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

// ─── Series colors follow the palette ──────────────────────────────
//
// These builders used to hold a hardcoded SERIES_COLOR map, which froze
// every chart to the dark palette: a Tank line drew `#5ca8ff` on Day's
// cream while a Tank badge beside it drew `var(--tank)` = `#1f5491`. The
// colors now resolve from tokens at build time, so a rebuild under a
// different theme must produce different output.
describe('trend-options — series colors resolve from palette tokens', () => {
  function setPalette(tokens: Record<string, string>): void {
    for (const [name, value] of Object.entries(tokens)) {
      document.documentElement.style.setProperty(name, value)
    }
  }

  afterEach(() => {
    document.documentElement.removeAttribute('style')
  })

  const roleSeries: TrendSeries[] = [
    { key: 'tank', name: 'Tank', points: [{ t: 1, v: 50, matchKey: 'a' }] },
  ]

  function tankColor(): unknown {
    const series = lineOption(roleSeries).series as { color?: unknown }[] | undefined
    return series?.[0]?.color
  }

  it('picks up the current value of --tank', () => {
    setPalette({ '--tank': '#1f5491' })
    expect(tankColor()).toBe('#1f5491')
  })

  it('changes when the palette changes', () => {
    setPalette({ '--tank': '#1f5491' })
    const day = tankColor()
    setPalette({ '--tank': '#6ab8ff' })
    expect(tankColor()).not.toBe(day)
    expect(tankColor()).toBe('#6ab8ff')
  })

  // The area fill used to be built as `${color}40`. High-contrast defines
  // --tank as the 3-digit `#6df`, so that produced the unparseable
  // `#6df40`, which ECharts silently renders as transparent — the fill
  // just vanished on that one theme.
  it('builds an area fill that survives a 3-digit hex token', () => {
    setPalette({ '--tank': '#6df' })
    const series = lineOption(roleSeries, { area: true }).series as {
      areaStyle?: { color?: { colorStops?: { color: string }[] } }
    }[] | undefined
    const stops = series?.[0]?.areaStyle?.color?.colorStops ?? []

    expect(stops).toHaveLength(2)
    for (const stop of stops) {
      expect(stop.color).toMatch(/^rgba\(/)
      expect(stop.color).not.toContain('#')
    }
  })
})

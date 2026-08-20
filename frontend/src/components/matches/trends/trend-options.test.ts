import { LADDER_MAX } from '@/match/elo/elo-model'
import { TIER_ORDER, DIVISIONS_PER_TIER } from '@/match/trends/match-trends-helpers'

import { describe, it, expect, afterEach } from 'vitest'

import { rankLadderOption, rankPercentileOption, winrateOption, lineOption, rankDeltaOption, heatmapOption } from '@/components/matches/trends/trend-options'
import type { RankPoint, RankSeries, TrendSeries, WinrateGrid } from '@/match/trends/match-trends-helpers'

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
    { key: 'tank', label: 'Tank', points: [{ t: 1, score: 10, tier: 'gold', level: 3, progress: 0, percentile: null, change: 0, matchKey: 'm1' }] },
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

// ─── Shared accessors ──────────────────────────────────────────────
//
// TrendOption is the union of every registered ECharts piece, so each
// assertion narrows to the handful of fields it reads.

interface OptSeries {
  name?: string
  type?: string
  showSymbol?: boolean
  connectNulls?: boolean
  data?: { value: [number, number]; matchKey?: string; rank?: RankPoint }[]
  markLine?: { data?: { yAxis?: number }[] }
}

function seriesOf(opt: { series?: unknown }): OptSeries[] {
  return (opt.series ?? []) as OptSeries[]
}

function valueAxis(opt: { yAxis?: unknown }): {
  min?: number
  max?: number
  interval?: number
  scale?: boolean
  axisLabel?: { formatter?: (v: number) => string }
} {
  return opt.yAxis as { min?: number; max?: number; interval?: number; scale?: boolean; axisLabel?: { formatter?: (v: number) => string } }
}

function tooltipOf(opt: { tooltip?: unknown }): {
  trigger?: string
  formatter?: (params: unknown) => string
  valueFormatter?: (v: unknown) => string
} {
  return opt.tooltip as { trigger?: string; formatter?: (params: unknown) => string; valueFormatter?: (v: unknown) => string }
}

function legendShown(opt: { legend?: unknown }): boolean | undefined {
  return (opt.legend as { show?: boolean } | undefined)?.show
}

function rankPoint(over: Partial<RankPoint> = {}): RankPoint {
  return { t: 1, score: 12.4, tier: 'gold', level: 3, progress: 40, percentile: null, change: 2, matchKey: 'm1', ...over }
}

function trend(key: string, values: number[]): TrendSeries {
  return { name: key, key, points: values.map((v, i) => ({ t: 1000 + i, v, matchKey: `m${i}` })) }
}

// ─── Rank ladder ───────────────────────────────────────────────────

describe('trend-options — rank ladder axis', () => {
  it('brackets the plotted scores to whole tier boundaries', () => {
    const opt = rankLadderOption([
      { key: 'tank', label: 'Tank', points: [rankPoint({ score: 12.4 })] },
      { key: 'dps', label: 'DPS', points: [rankPoint({ score: 27.6 }), rankPoint({ score: 21 })] },
    ])

    // 12.4 floors to the Gold boundary, 27.6 ceils to the Master one, and the
    // tier grid stays every 5 ladder units.
    expect(valueAxis(opt).min).toBe(10)
    expect(valueAxis(opt).max).toBe(30)
    expect(valueAxis(opt).interval).toBe(5)
  })

  it('gives a lone reading a whole tier band to sit in', () => {
    const opt = rankLadderOption([{ key: 'tank', label: 'Tank', points: [rankPoint({ score: 12.4 })] }])

    expect(valueAxis(opt).min).toBe(10)
    expect(valueAxis(opt).max).toBe(15)
    expect(seriesOf(opt)).toHaveLength(1)
  })

  it('falls back to the whole ladder when there is nothing to plot', () => {
    const opt = rankLadderOption([{ key: 'tank', label: 'Tank', points: [] }])

    expect(valueAxis(opt).min).toBe(0)
    // Derived, so inserting a tier moves the axis instead of failing here.
    expect(valueAxis(opt).max).toBe(LADDER_MAX)
  })

  it('labels only the tier boundaries, and nothing above the ladder', () => {
    const format = valueAxis(rankLadderOption([])).axisLabel?.formatter
    expect(format?.(0)).toBe('Bronze')
    // Emerald sits between Platinum and Diamond, so every boundary above
    // Platinum moved up one tier-width.
    expect(format?.(15)).toBe('Platinum')
    expect(format?.(20)).toBe('Emerald')
    expect(format?.(25)).toBe('Diamond')
    expect(format?.((TIER_ORDER.length - 1) * DIVISIONS_PER_TIER)).toBe('Champion')
    expect(format?.(12)).toBe('') // between boundaries
    expect(format?.(LADDER_MAX)).toBe('') // past the top tier
  })

  it('spells the tooltip out as tier, division, progress and this match’s change', () => {
    const format = tooltipOf(rankLadderOption([])).formatter

    // "40% progress" rather than a bare "40%": the percentile clause below can
    // sit on the same line, and two unlabeled percentages leave the reader to
    // work out which is which.
    expect(format?.({ seriesName: 'Tank', data: { rank: rankPoint() } }))
      .toBe('Tank — Gold 3 · 40% progress · +2% this match')
    expect(format?.({ seriesName: 'Tank', data: { rank: rankPoint({ change: -3 }) } }))
      .toContain('-3% this match')
    // An unread MOVEMENT is omitted too. This is the case a non-nullable
    // RankPoint.change made impossible to write, which is exactly how the
    // tooltip went on stating "0% this match" for a pill nobody read while its
    // two siblings were being fixed.
    const noChange = format?.({ seriesName: 'Tank', data: { rank: rankPoint({ change: null }) } })
    // "this match" is the movement clause; asserting on "0%" alone would match
    // the "0%" inside "40% progress".
    expect(noChange).not.toContain('this match')
    expect(noChange).toContain('Gold 3')
    // A NULL progress is omitted, not interpolated: the parser distinguishes an
    // unread caption from a real 0, and the raw template printed "null%".
    const unread = format?.({ seriesName: 'Tank', data: { rank: rankPoint({ progress: null }) } })
    expect(unread).not.toContain('null')
    expect(unread).toContain('Gold 3')
    // The ground-truth reading rides along when the capture reported one.
    expect(format?.({ seriesName: 'Tank', data: { rank: rankPoint({ percentile: 57 }) } }))
      .toContain('above 57%')
    // Hovering anything that isn't a rank reading (the mark area, a gap) must
    // not render a half-built string.
    expect(format?.({ seriesName: 'Tank', data: {} })).toBe('')
  })

  it('carries each point’s match key so a click can open that match', () => {
    const opt = rankLadderOption([{ key: 'tank', label: 'Tank', points: [rankPoint({ t: 77, matchKey: 'k7' })] }])

    expect(seriesOf(opt)[0]?.data?.[0]?.value).toEqual([77, 12.4])
    expect(seriesOf(opt)[0]?.data?.[0]?.matchKey).toBe('k7')
  })
})

// ─── Density + gaps, shared by every line builder ──────────────────

describe('trend-options — line density and gaps', () => {
  const builders: Record<string, (s: TrendSeries[]) => { series?: unknown }> = {
    'rolling win-rate': winrateOption,
    'generic line': (s) => lineOption(s),
  }

  for (const [name, build] of Object.entries(builders)) {
    it(`${name}: drops the point symbols once the line passes 80 readings`, () => {
      const at80 = build([trend('tank', Array.from({ length: 80 }, (_, i) => i))])
      const at81 = build([trend('tank', Array.from({ length: 81 }, (_, i) => i))])

      expect(seriesOf(at80)[0]?.showSymbol).toBe(true)
      expect(seriesOf(at81)[0]?.showSymbol).toBe(false)
    })

    it(`${name}: connects across gaps, since a metric can be missing for a match`, () => {
      expect(seriesOf(build([trend('eliminations', [1, 2])]))[0]?.connectNulls).toBe(true)
    })
  }

  it('shows the legend only once there is more than one line to tell apart', () => {
    expect(legendShown(winrateOption([trend('tank', [50])]))).toBe(false)
    expect(legendShown(winrateOption([trend('tank', [50]), trend('dps', [40])]))).toBe(true)
    expect(legendShown(lineOption([]))).toBe(false)
  })
})

// ─── Rolling win-rate ──────────────────────────────────────────────

describe('trend-options — rolling win-rate', () => {
  it('pins the axis to the full 0–100 range so a flat line still reads as high or low', () => {
    const axis = valueAxis(winrateOption([trend('tank', [48, 52])]))
    expect(axis.min).toBe(0)
    expect(axis.max).toBe(100)
  })

  it('draws the 50% reference line exactly once, on the first line', () => {
    const series = seriesOf(winrateOption([trend('tank', [50]), trend('dps', [40]), trend('support', [60])]))

    expect(series[0]?.markLine?.data).toEqual([{ yAxis: 50 }])
    expect(series[1]?.markLine).toBeUndefined()
    expect(series[2]?.markLine).toBeUndefined()
  })

  it('suffixes tooltip values with a percent sign', () => {
    expect(tooltipOf(winrateOption([])).valueFormatter?.(62)).toBe('62%')
  })
})

// ─── Rank delta bars ───────────────────────────────────────────────

describe('trend-options — rank delta', () => {
  it('plots bars crossing zero, signing the gains', () => {
    const opt = rankDeltaOption([trend('tank', [22, -18])])
    const format = tooltipOf(opt).valueFormatter

    expect(seriesOf(opt)[0]?.type).toBe('bar')
    expect(format?.(22)).toBe('+22%')
    expect(format?.(-18)).toBe('-18%')
    expect(format?.(0)).toBe('0%')
    // ECharts hands the axis tooltip a '-' for a series with no bar at that
    // tick; rendering "NaN%" there was the alternative.
    expect(format?.('-')).toBe('')
  })
})

// ─── Best-times heatmap ────────────────────────────────────────────

const grid: WinrateGrid = {
  dayLabels: ['Sun', 'Mon'],
  bucketLabels: ['00–04', '04–08'],
  cells: [
    { x: 0, y: 0, wins: 3, total: 4, winRate: 75 },
    { x: 1, y: 1, wins: 0, total: 2, winRate: 0 },
  ],
}

describe('trend-options — best-times heatmap', () => {
  it('is a static grid: no zoom slider, no brush', () => {
    const opt = heatmapOption(grid) as { dataZoom?: unknown; brush?: unknown }

    expect(opt.dataZoom).toBeUndefined()
    expect(opt.brush).toBeUndefined()
  })

  it('lays the day rows against the time-of-day columns', () => {
    const opt = heatmapOption(grid) as {
      xAxis?: { data?: string[] }
      yAxis?: { data?: string[]; inverse?: boolean }
      visualMap?: { min?: number; max?: number }
    }

    expect(opt.xAxis?.data).toEqual(grid.bucketLabels)
    expect(opt.yAxis?.data).toEqual(grid.dayLabels)
    // Rows read top-down from the week start, so the category axis inverts.
    expect(opt.yAxis?.inverse).toBe(true)
    // The ramp is anchored to the full 0–100 range, not the observed spread —
    // otherwise a set of 60–70% cells would paint one of them pure red.
    expect(opt.visualMap?.min).toBe(0)
    expect(opt.visualMap?.max).toBe(100)
  })

  it('plots one cell per played bucket, carrying the volume for the tooltip', () => {
    const cells = seriesOf(heatmapOption(grid))[0]?.data as unknown as
      { value: [number, number, number]; wins: number; total: number }[]

    expect(cells).toHaveLength(2)
    expect(cells[0]?.value).toEqual([0, 0, 75])
    expect(cells[0]?.wins).toBe(3)
    expect(cells[0]?.total).toBe(4)
  })

  // The ramp maps win rate alone, so without a floor a single won match
  // paints a slot full green and the card recommends playing then.
  it('withholds the verdict color from a slot with too little evidence', () => {
    const thin = {
      ...grid,
      cells: [
        { x: 0, y: 0, wins: 1, total: 1, winRate: 100 },   // one match
        { x: 1, y: 1, wins: 14, total: 20, winRate: 70 },  // past the floor
      ],
    }
    const cells = seriesOf(heatmapOption(thin))[0]?.data as unknown as
      { itemStyle?: { color?: string } }[]

    // themeColor() reads a real stylesheet, so under happy-dom it resolves
    // to ''. The contract is that the sub-floor cell is overridden at all and
    // the judged one is left to the ramp.
    expect(cells[0]?.itemStyle).toBeDefined()
    expect(cells[1]?.itemStyle).toBeUndefined()
  })

  it('reads a cell out as day, bucket, record and win rate', () => {
    const format = tooltipOf(heatmapOption(grid)).formatter

    expect(format?.({ data: { value: [1, 1, 0], wins: 0, total: 2 } })).toBe('Mon 04–08 · 0W–2L · 0%')
    // An out-of-range coordinate (a stale option against a re-bucketed grid)
    // degrades to blanks rather than "undefined".
    expect(format?.({ data: { value: [9, 9, 50], wins: 1, total: 2 } })).toBe('  · 1W–1L · 50%')
    expect(format?.({})).toBe('')
  })
})

// ─── Series with no semantic token ─────────────────────────────────

describe('trend-options — lines with no role token', () => {
  const unmapped = trend('ana', [50, 60])

  // Heroes, maps and modifiers have no palette token of their own; hardcoding
  // a color for them would fight the chart theme's categorical palette.
  it('leaves an unmapped line for the themed categorical palette to color', () => {
    for (const build of [winrateOption, (s: TrendSeries[]) => lineOption(s), rankDeltaOption]) {
      expect(seriesOf(build([unmapped]))[0]).not.toHaveProperty('color')
    }
    expect(seriesOf(rankLadderOption([{ key: 'ana', label: 'Ana', points: [rankPoint()] }]))[0])
      .not.toHaveProperty('color')
  })

  it('still fills the area under it, on the neutral tint', () => {
    document.documentElement.style.setProperty('--text-mute', '#808080')
    const areaStyle = seriesOf(lineOption([unmapped], { area: true }))[0] as unknown as
      { areaStyle?: { color?: { colorStops?: { color: string }[] } } }
    const stops = areaStyle.areaStyle?.color?.colorStops ?? []
    document.documentElement.removeAttribute('style')

    expect(stops.map((s) => s.color)).toEqual(['rgba(128, 128, 128, 0.25)', 'rgba(128, 128, 128, 0)'])
  })
})

// "Ranked above" reads in a BAND around the player's own readings, not the
// full population axis: an always-Gold player lives at 20-40%, and a 0-100
// axis flattened their entire history into a near-horizontal line. The band
// is the data padded ±10 points, rounded outward to tens, clamped to [0,100].
describe('rankPercentileOption — the banded axis', () => {
  const series = (vs: number[]) => [{
    key: 'tank', name: 'Tank',
    points: vs.map((v, i) => ({ t: i + 1, v, matchKey: `m${i}` })),
  }]

  const axis = (vs: number[]) => {
    const y = rankPercentileOption(series(vs) as never).yAxis as { min: number; max: number }
    return [y.min, y.max]
  }

  it('a flat always-Gold reading gets its neighborhood, not the world', () => {
    expect(axis([30, 30, 30])).toEqual([20, 40])
  })

  it('a moving series is padded and rounded outward to tens', () => {
    expect(axis([57, 61])).toEqual([40, 80])
  })

  it('clamps at the population edges', () => {
    expect(axis([95, 97])).toEqual([80, 100])
    expect(axis([3])).toEqual([0, 20])
  })

  it('an empty series falls back to the full axis', () => {
    expect(axis([])).toEqual([0, 100])
  })
})

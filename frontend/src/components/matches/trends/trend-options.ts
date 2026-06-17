// Builders that turn pure trend data (from match-trends-helpers) into
// ECharts options. This is the presentation seam — it knows about ECharts;
// the data layer does not.
import type { TrendOption } from '@/components/matches/trends/echarts'
import { TIER_ORDER, type RankPoint, type RankSeries, type Tier, type TrendSeries } from '@/match/match-trends-helpers'

// Consistent role colours across both charts so a Tank line is the same
// blue on the rank chart and the win-rate chart. Buckets without a mapped
// colour ('all') fall through to the chart's themed categorical palette.
const ROLE_SERIES_COLOR: Record<string, string> = {
  tank: '#5ca8ff',
  dps: '#ff6b6b',
  support: '#5ce1a0',
  open: '#f5a623',
}

function colorFor(key: string | undefined): string | undefined {
  return key ? ROLE_SERIES_COLOR[key] : undefined
}

// Reserve enough top room for the (centered) scroll legend so it never
// sits over the plot, and keep the y-axis NAME out of the options entirely
// — units live in the card title — so it can't collide with the legend.
const GRID = { left: 8, right: 18, top: 44, bottom: 6, containLabel: true } as const
const LEGEND = { type: 'scroll' as const, top: 8, left: 'center' as const }

function tierLabel(tier: Tier | string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}

// Rank over time: one line per role bucket on a ladder axis whose labels
// are tier names (a tier every 5 ladder units). Each point carries its raw
// rank fields so the tooltip can spell out tier / division / progress /
// change.
export function rankLadderOption(series: RankSeries[]): TrendOption {
  let lo = Infinity
  let hi = -Infinity
  for (const s of series) {
    for (const p of s.points) {
      lo = Math.min(lo, p.score)
      hi = Math.max(hi, p.score)
    }
  }
  const min = Number.isFinite(lo) ? Math.floor(lo / 5) * 5 : 0
  const max = Number.isFinite(hi) ? Math.ceil(hi / 5) * 5 : 40

  return {
    grid: GRID,
    legend: { ...LEGEND, show: series.length > 1 },
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown): string => {
        const p = params as { seriesName?: string; data?: { rank?: RankPoint } }
        const d = p.data?.rank
        if (!d) return ''
        const change = d.change > 0 ? `+${d.change}` : `${d.change}`
        return `${p.seriesName ?? ''} — ${tierLabel(d.tier)} ${d.level} · ${d.progress}% · ${change}% this match`
      },
    },
    xAxis: { type: 'time' },
    yAxis: {
      type: 'value',
      min,
      max,
      interval: 5,
      axisLabel: {
        formatter: (v: number): string =>
          v % 5 === 0 && TIER_ORDER[v / 5] ? tierLabel(TIER_ORDER[v / 5]!) : '',
      },
    },
    series: series.map((s) => ({
      name: s.label,
      type: 'line' as const,
      showSymbol: s.points.length <= 80,
      symbolSize: 5,
      connectNulls: true,
      emphasis: { focus: 'series' as const },
      ...(colorFor(s.key) ? { color: colorFor(s.key) } : {}),
      data: s.points.map((p) => ({ value: [p.t, p.score] as [number, number], rank: p })),
    })),
  }
}

// Rolling win-rate: one 0–100 line per role bucket with a dashed 50%
// reference line.
export function winrateOption(series: TrendSeries[]): TrendOption {
  return {
    grid: GRID,
    legend: { ...LEGEND, show: series.length > 1 },
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => `${String(v)}%` },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', min: 0, max: 100 },
    series: series.map((s, i) => ({
      name: s.name,
      type: 'line' as const,
      showSymbol: s.points.length <= 80,
      symbolSize: 5,
      connectNulls: true,
      emphasis: { focus: 'series' as const },
      ...(colorFor(s.key) ? { color: colorFor(s.key) } : {}),
      data: s.points.map((p) => [p.t, p.v] as [number, number]),
      // Draw the reference line once (on the first series).
      ...(i === 0
        ? {
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ yAxis: 50 }],
            lineStyle: { type: 'dashed' as const },
            label: { formatter: '50%' },
          },
        }
        : {}),
    })),
  }
}

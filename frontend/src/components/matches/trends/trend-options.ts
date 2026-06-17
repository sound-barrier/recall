// Builders that turn pure TrendSeries data (from match-trends-helpers)
// into ECharts options. This is the presentation seam — it knows about
// ECharts; the data layer does not. Series carry no explicit colour so
// they inherit the themed categorical palette TrendChart sets per
// theme, in series order.
import type { TrendOption } from '@/components/matches/trends/echarts'
import type { TrendSeries } from '@/match/match-trends-helpers'

const GRID = { left: 6, right: 18, top: 30, bottom: 6, containLabel: true } as const

function lineSeries(series: TrendSeries) {
  return {
    name: series.name,
    type: 'line' as const,
    // Markers clutter dense lines; show them only on sparse series.
    showSymbol: series.points.length <= 80,
    symbolSize: 5,
    connectNulls: true,
    emphasis: { focus: 'series' as const },
    data: series.points.map((p) => [p.t, p.v] as [number, number]),
  }
}

// Multiple lines sharing one value axis (SR by hero, per-10 stats).
export function multiLineOption(series: TrendSeries[], yName: string): TrendOption {
  return {
    grid: GRID,
    legend: { type: 'scroll', top: 0, left: 0 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', name: yName, scale: true },
    series: series.map(lineSeries),
  }
}

// One per-match stat line with a soft fill.
export function statOption(series: TrendSeries): TrendOption {
  return {
    grid: GRID,
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', scale: true },
    series: [{ ...lineSeries(series), areaStyle: { opacity: 0.06 } }],
  }
}

// Rolling win-rate: 0–100 axis with a dashed 50% reference line.
export function winrateOption(series: TrendSeries): TrendOption {
  return {
    grid: GRID,
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', min: 0, max: 100, name: '%' },
    series: [{
      ...lineSeries(series),
      areaStyle: { opacity: 0.08 },
      markLine: {
        silent: true,
        symbol: 'none',
        data: [{ yAxis: 50 }],
        lineStyle: { type: 'dashed' },
        label: { formatter: '50%' },
      },
    }],
  }
}

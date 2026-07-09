// Builds the Elo Calculator's projection chart — games on X, rank ladder on Y:
// the two futures (if your wins hold vs as opponents get tougher), a shaded
// "luck" band around the optimistic line, a dashed target line, and — when the
// target sits above your current ceiling — a marker at where you plateau.
// Presentation seam: this file knows ECharts; the model layer doesn't.
import type { TrendOption } from '@/components/matches/trends/echarts'
import { TIER_ORDER } from '@/match/match-trends-helpers'
import type { ProjectionCurves } from '@/match/elo-model'

// Fixed hues shared with the two future cards (see styles/elo.css): blue = if
// your wins hold, amber = as opponents get tougher.
const DREAM_COLOR = '#5ca8ff'
const REALITY_COLOR = '#f5a623'
const BAND_COLOR = 'rgba(92, 168, 255, 0.14)'

const DREAM_NAME = 'If your wins hold'
const REALITY_NAME = 'As opponents get tougher'

// scoreToRankLabel renders a ladder score as "Gold 2" for the tooltip.
function scoreToRankLabel(score: number): string {
  const clamped = Math.min(39.999, Math.max(0, score))
  const tier = TIER_ORDER[Math.floor(clamped / 5)] ?? 'champion'
  const division = 5 - Math.floor(clamped % 5)
  return `${tier.charAt(0).toUpperCase() + tier.slice(1)} ${division}`
}

function pairs(games: number[], values: number[]): [number, number][] {
  return games.map((g, i) => [g, values[i] ?? 0])
}

export interface EloChartOpts {
  targetScore: number
  targetLabel: string
  // When the target is above the player's current ceiling, draw a dotted line
  // there so the plateau reads visually.
  ceilingScore?: number
}

export function buildEloProjectionOption(curves: ProjectionCurves, opts: EloChartOpts): TrendOption {
  const all = [...curves.naive, ...curves.decay, ...curves.bandLow, ...curves.bandHigh, opts.targetScore]
  const min = Math.max(0, Math.floor(Math.min(...all) / 5) * 5)
  const max = Math.min(40, Math.ceil(Math.max(...all) / 5) * 5)

  return {
    grid: { left: 8, right: 16, top: 42, bottom: 30, containLabel: true },
    legend: { type: 'scroll', top: 6, left: 'center', itemWidth: 18, itemHeight: 3, data: [DREAM_NAME, REALITY_NAME] },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown): string => {
        const rows = params as { seriesName?: string; value?: [number, number] }[]
        const model = rows.filter((r) => r.seriesName === DREAM_NAME || r.seriesName === REALITY_NAME)
        if (model.length === 0 || !model[0]?.value) return ''
        const games = Math.round(model[0].value[0])
        const lines = model.map((r) => `${r.seriesName}: ${scoreToRankLabel(r.value?.[1] ?? 0)}`)
        return [`After ${games} games`, ...lines].join('<br/>')
      },
    },
    xAxis: { type: 'value', name: 'games played', nameLocation: 'middle', nameGap: 26, max: curves.horizonGames },
    yAxis: {
      type: 'value',
      min,
      max,
      interval: 5,
      axisLabel: {
        formatter: (v: number): string => {
          const tier = TIER_ORDER[v / 5]
          return v % 5 === 0 && tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : ''
        },
      },
    },
    series: [
      // The luck band: an invisible base line at the lower bound plus a stacked
      // filled spread up to the upper bound. Silent + unnamed so it reads as
      // background, not a third line.
      {
        name: 'band-base',
        type: 'line',
        stack: 'ci',
        silent: true,
        showSymbol: false,
        lineStyle: { opacity: 0 },
        tooltip: { show: false },
        data: pairs(curves.games, curves.bandLow),
      },
      {
        name: 'band-spread',
        type: 'line',
        stack: 'ci',
        silent: true,
        showSymbol: false,
        lineStyle: { opacity: 0 },
        areaStyle: { color: BAND_COLOR },
        tooltip: { show: false },
        data: pairs(curves.games, curves.games.map((_, i) => (curves.bandHigh[i] ?? 0) - (curves.bandLow[i] ?? 0))),
      },
      {
        name: DREAM_NAME,
        type: 'line',
        color: DREAM_COLOR,
        showSymbol: false,
        data: pairs(curves.games, curves.naive),
        markLine: {
          silent: true,
          symbol: 'none',
          // Anchored left so it never collides with the "Your ceiling now"
          // label (right) or the converging line-ends.
          label: { formatter: `Target · ${opts.targetLabel}`, position: 'insideStartTop' },
          lineStyle: { type: 'dashed' },
          data: [{ yAxis: opts.targetScore }],
        },
      },
      {
        name: REALITY_NAME,
        type: 'line',
        color: REALITY_COLOR,
        showSymbol: false,
        data: pairs(curves.games, curves.decay),
        ...(opts.ceilingScore !== undefined
          ? {
              markLine: {
                silent: true,
                symbol: 'none',
                label: { formatter: 'Your ceiling now', position: 'insideEndBottom', color: REALITY_COLOR },
                lineStyle: { type: 'dotted', color: REALITY_COLOR },
                data: [{ yAxis: opts.ceilingScore }],
              },
            }
          : {}),
      },
    ],
  }
}

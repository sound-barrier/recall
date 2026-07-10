// Builds the Elo Calculator's projection chart — games on X, rank ladder on Y:
// the two futures (if your wins hold vs as opponents get tougher), a shaded
// "luck" band around the optimistic line, a dashed target line, and — when the
// target sits above your current ceiling — a marker at where you plateau.
// Presentation seam: this file knows ECharts; the model layer doesn't.
import type { TrendOption } from '@/components/matches/trends/echarts'
import { TIER_ORDER } from '@/match/match-trends-helpers'
import type { ProjectionCurves } from '@/match/elo-model'
import type { SeasonSim } from '@/match/elo-simulate'
import type { SkillCurve } from '@/match/elo-kalman'

// Fixed hues shared with the two future cards (see styles/elo.css): blue = if
// your wins hold, amber = as opponents get tougher.
const DREAM_COLOR = '#5ca8ff'
const REALITY_COLOR = '#f5a623'
const BAND_COLOR = 'rgba(92, 168, 255, 0.14)'
const SIM_COLOR = 'rgba(160, 160, 160, 0.55)'
const SIM_BAND_COLOR = 'rgba(160, 160, 160, 0.16)'
const SKILL_COLOR = '#8bc7a0'
const SKILL_BAND_COLOR = 'rgba(139, 199, 160, 0.16)'

const DREAM_NAME = 'If your wins hold'
const REALITY_NAME = 'As opponents get tougher'
const SIM_NAME = 'Simulated range'

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
  // The simulator's 10–90% envelope over games — drawn as a second silent
  // band (gray) behind the model curves.
  fan?: SeasonSim['fan']
}

export function buildEloProjectionOption(curves: ProjectionCurves, opts: EloChartOpts): TrendOption {
  const fan = opts.fan
  const all = [
    ...curves.naive, ...curves.decay, ...curves.bandLow, ...curves.bandHigh, opts.targetScore,
    ...(fan ? [...fan.p10, ...fan.p90] : []),
  ]
  const min = Math.max(0, Math.floor(Math.min(...all) / 5) * 5)
  const max = Math.min(40, Math.ceil(Math.max(...all) / 5) * 5)
  const xMax = Math.max(curves.horizonGames, fan?.games[fan.games.length - 1] ?? 0)

  return {
    grid: { left: 8, right: 16, top: 42, bottom: 30, containLabel: true },
    legend: {
      type: 'scroll', top: 6, left: 'center', itemWidth: 18, itemHeight: 3,
      data: [DREAM_NAME, REALITY_NAME, ...(fan ? [SIM_NAME] : [])],
    },
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
    xAxis: { type: 'value', name: 'games played', nameLocation: 'middle', nameGap: 26, max: xMax },
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
      // The simulator's 10–90% envelope, farthest back: same stacked-band
      // trick as the luck band, but named so the legend can toggle it.
      ...(fan
        ? [
            {
              name: 'sim-base',
              type: 'line' as const,
              stack: 'sim',
              silent: true,
              showSymbol: false,
              lineStyle: { opacity: 0 },
              tooltip: { show: false },
              data: pairs(fan.games, fan.p10),
            },
            {
              name: SIM_NAME,
              type: 'line' as const,
              stack: 'sim',
              color: SIM_COLOR,
              silent: true,
              showSymbol: false,
              lineStyle: { opacity: 0 },
              areaStyle: { color: SIM_BAND_COLOR },
              tooltip: { show: false },
              data: pairs(fan.games, fan.games.map((_, i) => (fan.p90[i] ?? 0) - (fan.p10[i] ?? 0))),
            },
          ]
        : []),
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

// buildSkillCurveOption renders the Kalman-smoothed "true skill" line over
// calendar time with its 1.96σ band — the de-noised version of the raw
// rank-over-time chart, on the same tier-name ladder axis.
export function buildSkillCurveOption(curve: SkillCurve): TrendOption {
  const low = curve.level.map((v, i) => Math.max(0, v - (curve.halfWidth[i] ?? 0)))
  const high = curve.level.map((v, i) => Math.min(40, v + (curve.halfWidth[i] ?? 0)))
  const min = Math.max(0, Math.floor(Math.min(...low) / 5) * 5)
  const max = Math.min(40, Math.ceil(Math.max(...high) / 5) * 5)
  const at = (values: number[]): [number, number][] => curve.t.map((t, i) => [t, values[i] ?? 0])

  return {
    grid: { left: 8, right: 16, top: 18, bottom: 26, containLabel: true },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown): string => {
        const rows = params as { seriesName?: string; value?: [number, number] }[]
        const main = rows.find((r) => r.seriesName === 'True skill')
        if (!main?.value) return ''
        return `${new Date(main.value[0]).toLocaleDateString()}<br/>True skill: ${scoreToRankLabel(main.value[1])}`
      },
    },
    xAxis: { type: 'time' },
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
      {
        name: 'skill-band-base',
        type: 'line',
        stack: 'skill',
        silent: true,
        showSymbol: false,
        lineStyle: { opacity: 0 },
        tooltip: { show: false },
        data: at(low),
      },
      {
        name: 'skill-band-spread',
        type: 'line',
        stack: 'skill',
        silent: true,
        showSymbol: false,
        lineStyle: { opacity: 0 },
        areaStyle: { color: SKILL_BAND_COLOR },
        tooltip: { show: false },
        data: at(curve.t.map((_, i) => (high[i] ?? 0) - (low[i] ?? 0))),
      },
      {
        name: 'True skill',
        type: 'line',
        color: SKILL_COLOR,
        showSymbol: false,
        smooth: true,
        data: at(curve.level),
      },
    ],
  }
}

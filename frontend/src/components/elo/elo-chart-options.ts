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
import { themeColor, withAlpha } from '@/match/theme-colors'

// Series hues shared with the two future cards (see styles/elo.css, which
// aliases the same tokens as --elo-dream / --elo-reality): blue = if your
// wins hold, amber = as opponents get tougher, green = fitted skill.
//
// Tokens rather than literals, and read per call rather than frozen into
// module constants, so the chart follows the theme. Hardcoded, these drew
// the Night palette on every theme — a light `#5ca8ff` line over Day's
// cream while the card border beside it used the same token name resolved
// to a dark blue.
//
// The underlying palette tokens are read directly rather than the --elo-*
// aliases: alias resolution through getPropertyValue depends on the engine
// substituting var() at computed-value time, and there's no reason to
// depend on that here.
const dreamColor = () => themeColor('--tank')
const realityColor = () => themeColor('--accent')
const skillColor = () => themeColor('--support')
const bandColor = () => withAlpha(dreamColor(), 0.14)
const skillBandColor = () => withAlpha(skillColor(), 0.16)
// The simulated range is deliberately NEUTRAL — it reads as "noise around
// the signal", so it tracks the muted text tone rather than a series hue.
const simColor = () => withAlpha(themeColor('--text-mute'), 0.55)
const simBandColor = () => withAlpha(themeColor('--text-mute'), 0.16)

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
  // The ceiling's credible range — drawn as a translucent band around the
  // dotted line so the plateau reads as an estimate, not a fact. hi=null
  // (no ceiling detectable) suppresses the band; a degenerate range keeps
  // just the line.
  ceilingBand?: { lo: number; hi: number }
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
              color: simColor(),
              silent: true,
              showSymbol: false,
              lineStyle: { opacity: 0 },
              areaStyle: { color: simBandColor() },
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
        areaStyle: { color: bandColor() },
        tooltip: { show: false },
        data: pairs(curves.games, curves.games.map((_, i) => (curves.bandHigh[i] ?? 0) - (curves.bandLow[i] ?? 0))),
      },
      {
        name: DREAM_NAME,
        type: 'line',
        color: dreamColor(),
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
        color: realityColor(),
        showSymbol: false,
        data: pairs(curves.games, curves.decay),
        ...(opts.ceilingScore !== undefined
          ? {
              markLine: {
                silent: true,
                symbol: 'none',
                label: { formatter: 'Your ceiling now', position: 'insideEndBottom', color: realityColor() },
                lineStyle: { type: 'dotted', color: realityColor() },
                data: [{ yAxis: opts.ceilingScore }],
              },
            }
          : {}),
        ...(opts.ceilingBand !== undefined && opts.ceilingBand.hi > opts.ceilingBand.lo
          ? {
              markArea: {
                silent: true,
                itemStyle: { color: realityColor(), opacity: 0.08 },
                data: [[{ yAxis: opts.ceilingBand.lo }, { yAxis: opts.ceilingBand.hi }]],
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
export function buildSkillCurveOption(curve: SkillCurve, opts: { breakAt?: number } = {}): TrendOption {
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
        areaStyle: { color: skillBandColor() },
        tooltip: { show: false },
        data: at(curve.t.map((_, i) => (high[i] ?? 0) - (low[i] ?? 0))),
      },
      {
        name: 'True skill',
        type: 'line',
        color: skillColor(),
        showSymbol: false,
        smooth: true,
        data: at(curve.level),
        ...(opts.breakAt !== undefined
          ? {
              markLine: {
                silent: true,
                symbol: 'none',
                label: { formatter: 'Shift', position: 'insideEndTop' },
                lineStyle: { type: 'dashed' },
                data: [{ xAxis: opts.breakAt }],
              },
            }
          : {}),
      },
    ],
  }
}

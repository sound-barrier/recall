// Builders that turn pure trend data (from match-trends-helpers) into
// ECharts options. This is the presentation seam — it knows about ECharts;
// the data layer does not.
import type { TrendOption } from '@/components/matches/trends/echarts'
import { TIER_ORDER, type RankPoint, type RankSeries, type Tier, type TrendSeries, type WinrateGrid } from '@/match/match-trends-helpers'
import { themeColor, withAlpha } from '@/match/theme-colors'

// Consistent colors for known series keys so a line means the same thing
// across charts: a Tank line is the same blue on every rank/win-rate chart,
// and the combat metrics read semantically (eliminations green, deaths red,
// assists blue). Keys without a mapped token (heroes, maps, modifiers,
// 'all') fall through to the chart's themed categorical palette.
//
// These map to PALETTE TOKENS, not literal hues. They used to be hardcoded
// hex, which meant a Tank line drew `#5ca8ff` on every theme while a Tank
// badge three inches away drew `var(--tank)` — the same role in two
// different blues, and on Day a light-on-cream blue where the token is the
// dark `#1f5491` chosen for that ground. Resolving through the token makes
// the chart agree with the rest of the app and follow the theme for free.
//
// Read at option-build time: callers must rebuild their options when the
// theme changes (TrendsSection tracks `themeMode` for exactly this).
const SERIES_TOKEN: Record<string, string> = {
  tank: '--tank',
  dps: '--dps',
  support: '--support',
  open: '--accent',
  eliminations: '--win',
  deaths: '--loss',
  // Reuses the tank blue. Safe because the combat chart (elims/deaths/
  // assists) and the role charts are never the same chart, so the two
  // meanings can't collide in one legend.
  assists: '--tank',
}

function colorFor(key: string | undefined): string | undefined {
  const token = key ? SERIES_TOKEN[key] : undefined
  return token ? themeColor(token) : undefined
}

// A subtle vertical fill under a line — the series color at ~25% alpha
// fading to transparent at the baseline — for a "climb" feel on the rank
// ladder + cumulative net. Fading out at the bottom keeps overlapping role
// fills readable; the rare unmapped series (the 'all' bucket) gets a neutral
// tint so the shape stays a gradient either way.
// withAlpha rather than the old `${c}40` hex-suffix concatenation: that
// assumed a 6-digit hex and produced the invalid `#6df40` for any 3-digit
// token (high-contrast defines --tank as `#6df`). ECharts treats an
// unparseable color as transparent, so the fill silently vanished on that
// theme with nothing logged.
function areaFill(key: string | undefined) {
  const c = colorFor(key) ?? themeColor('--text-mute')
  return {
    color: {
      type: 'linear' as const,
      x: 0, y: 0, x2: 0, y2: 1,
      colorStops: [
        { offset: 0, color: withAlpha(c, 0.25) },
        { offset: 1, color: withAlpha(c, 0) },
      ],
    },
  }
}

// Reserve top room for the (centered) scroll legend so it never sits over
// the plot, and bottom room for the zoom slider. Units live in the card
// title (no y-axis name to collide with the legend).
const GRID = { left: 8, right: 18, top: 44, bottom: 34, containLabel: true } as const
const LEGEND = { type: 'scroll' as const, top: 8, left: 'center' as const }

// Shared interactions across every trends chart: a bottom zoom/pan slider
// (its handles zoom, its body pans — no wheel zoom, so page scroll isn't
// hijacked and body-drag stays free for the brush), and an always-on
// lineX brush (TrendChart arms the cursor) whose selection narrows the set.
// `handleLabel` shows the date at each slider handle while dragging (echarts
// 6.1 defaults it to hover-only; we make it always-on).
const INTERACTION = {
  dataZoom: [
    { type: 'slider' as const, bottom: 4, height: 16, handleLabel: { show: true } },
  ],
  brush: {
    xAxisIndex: 0,
    brushType: 'lineX' as const,
    brushMode: 'single' as const,
    throttleType: 'debounce' as const,
    throttleDelay: 250,
    removeOnClick: false,
    brushStyle: { color: 'rgba(245, 166, 35, 0.12)', borderColor: 'rgba(245, 166, 35, 0.55)' },
  },
}

function tierLabel(tier: Tier): string {
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
    ...INTERACTION,
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
      areaStyle: areaFill(s.key),
      ...(colorFor(s.key) ? { color: colorFor(s.key) } : {}),
      data: s.points.map((p) => ({ value: [p.t, p.score] as [number, number], rank: p, matchKey: p.matchKey })),
    })),
  }
}

// Rolling win-rate: one 0–100 line per role bucket with a dashed 50%
// reference line.
export function winrateOption(series: TrendSeries[]): TrendOption {
  return {
    ...INTERACTION,
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
      data: s.points.map((p) => ({ value: [p.t, p.v] as [number, number], matchKey: p.matchKey })),
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

// A generic multi-line chart (cumulative net record; modifier frequency).
// Auto value axis; role-colored where the series key is a role bucket,
// else the themed categorical palette (e.g. one color per modifier).
export function lineOption(series: TrendSeries[], opts: { area?: boolean } = {}): TrendOption {
  return {
    ...INTERACTION,
    grid: GRID,
    legend: { ...LEGEND, show: series.length > 1 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', scale: true },
    series: series.map((s) => ({
      name: s.name,
      type: 'line' as const,
      showSymbol: s.points.length <= 80,
      symbolSize: 5,
      connectNulls: true,
      emphasis: { focus: 'series' as const },
      ...(opts.area ? { areaStyle: areaFill(s.key) } : {}),
      ...(colorFor(s.key) ? { color: colorFor(s.key) } : {}),
      data: s.points.map((p) => ({ value: [p.t, p.v] as [number, number], matchKey: p.matchKey })),
    })),
  }
}

// Per-match rank delta as bars crossing zero (gains up / losses down),
// one role-colored series each.
export function rankDeltaOption(series: TrendSeries[]): TrendOption {
  return {
    ...INTERACTION,
    grid: GRID,
    legend: { ...LEGEND, show: series.length > 1 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v: unknown) => {
        const n = Number(v)
        if (!Number.isFinite(n)) return ''
        return n > 0 ? `+${n}%` : `${n}%`
      },
    },
    xAxis: { type: 'time' },
    yAxis: { type: 'value' },
    series: series.map((s) => ({
      name: s.name,
      type: 'bar' as const,
      ...(colorFor(s.key) ? { color: colorFor(s.key) } : {}),
      data: s.points.map((p) => ({ value: [p.t, p.v] as [number, number], matchKey: p.matchKey })),
    })),
  }
}

// "Best times to play" — a day-of-week × time-of-day win-rate heatmap. This
// is a STATIC grid (category × category, no time axis / brush / zoom — the
// hosting card passes `interactive: false`), so it deliberately omits the
// shared INTERACTION. Each cell is colored by win-rate on a red→green
// diverging scale centered on 50%; cells with no decisive match are absent
// from the data and render blank. Volume (W–L) rides in the tooltip.
export function heatmapOption(grid: WinrateGrid): TrendOption {
  return {
    grid: { left: 8, right: 12, top: 12, bottom: 52, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown): string => {
        const d = (params as { data?: { value: [number, number, number]; wins: number; total: number } }).data
        if (!d) return ''
        const day = grid.dayLabels[d.value[1]] ?? ''
        const bucket = grid.bucketLabels[d.value[0]] ?? ''
        return `${day} ${bucket} · ${d.wins}W–${d.total - d.wins}L · ${d.value[2]}%`
      },
    },
    xAxis: { type: 'category', data: grid.bucketLabels, splitArea: { show: true }, axisTick: { show: false } },
    yAxis: { type: 'category', data: grid.dayLabels, inverse: true, splitArea: { show: true }, axisTick: { show: false } },
    visualMap: {
      min: 0,
      max: 100,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 2,
      text: ['100%', '0%'],
      // The loss→draw→win ramp, from the palette. Hardcoded, these were
      // the Night hues, so on Day the heatmap ran bright-red-to-neon-green
      // over cream while every other win/loss surface used the muted
      // #c0354a / #0f7a3a pair.
      inRange: { color: [themeColor('--loss'), themeColor('--draw'), themeColor('--win')] },
    },
    series: [{
      type: 'heatmap',
      data: grid.cells.map((c) => ({
        value: [c.x, c.y, c.winRate] as [number, number, number],
        wins: c.wins,
        total: c.total,
      })),
      label: { show: false },
      // --text, not '#fff': on Day the hover ring was white-on-cream and
      // effectively invisible.
      emphasis: { itemStyle: { borderColor: themeColor('--text'), borderWidth: 1 } },
    }],
  }
}

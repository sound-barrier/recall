import { describe, it, expect, vi } from 'vitest'
import { computed, defineComponent, h, type Component } from 'vue'
import { render, screen } from '@testing-library/vue'

import EloSkillCurve from '@/components/elo/EloSkillCurve.vue'
import { provideEloCalculator, type EloCalculator } from '@/composables/elo/useEloCalculator'
import type { SkillCurve } from '@/match/elo/elo-kalman'
import type { ChangePoint, ChangePointContext } from '@/match/elo/elo-changepoint'

// ECharts paints to a real canvas; happy-dom has none, so zrender's
// animation loop throws past the end of the test and fails the run. The
// option builder is pinned directly in elo-chart-options.test.ts, so the
// band only owes us that it renders a chart and hands it the caption
// that becomes the canvas's accessible name.
vi.mock('@/components/matches/trends/TrendChart.vue', () => ({
  default: defineComponent({
    props: {
      option: { type: Object, required: true },
      caption: { type: String, required: true },
      interactive: { type: Boolean, default: true },
    },
    setup: (props) => () => h('div', { role: 'img', 'aria-label': props.caption }),
  }),
}))

// The band is pure presentation over two model outputs — the Kalman
// curve and the (rare) dated break. Both are stubbed on the inject seam
// so every copy branch is reachable without steering a real filter into
// a saturated variance split.
const DAY = 86_400_000
const T0 = Date.UTC(2026, 4, 1)

function skillCurve(over: Partial<SkillCurve> = {}): SkillCurve {
  return {
    t: [T0, T0 + DAY, T0 + 2 * DAY, T0 + 3 * DAY],
    level: [12, 12.4, 12.9, 13.2],
    halfWidth: [0.6, 0.5, 0.5, 0.6],
    q: 0.02,
    r: 0.05,
    signalShare: 0.55,
    saturated: false,
    n: 48,
    ...over,
  }
}

type Break = { point: ChangePoint; context: ChangePointContext }

function shift(point: Partial<ChangePoint> = {}, context: Partial<ChangePointContext> = {}): Break {
  return {
    point: {
      index: 24,
      t: T0 + 2 * DAY,
      before: { winrate: 45, n: 24 },
      after: { winrate: 58, n: 24 },
      deltaPts: 13,
      pValue: 0.004,
      ...point,
    },
    context: { reviewStarted: false, poolEntered: [], poolLeft: [], ...context },
  }
}

function renderCurve(curve: SkillCurve | null, cp: Break | null = null): void {
  const stub: Partial<EloCalculator> = {
    skillCurve: computed(() => curve),
    changePoint: computed(() => cp),
  }
  const host = defineComponent({
    setup() {
      provideEloCalculator(stub as EloCalculator)
      return () => h(EloSkillCurve as Component)
    },
  })
  render(host)
}

describe('EloSkillCurve — the skill-vs-noise readout', () => {
  it('renders nothing without a filtered curve', () => {
    renderCurve(null)
    expect(screen.queryByRole('region', { name: 'Your true skill, filtered' })).not.toBeInTheDocument()
  })

  it('names the split, the reading count, and labels the chart for screen readers', () => {
    renderCurve(skillCurve({ signalShare: 0.55 }))
    expect(screen.getByRole('region', { name: 'Your true skill, filtered' })).toBeInTheDocument()
    expect(screen.getByText(/Skill drift explains 55% of your rank movement/)).toBeInTheDocument()
    expect(screen.getByText(/the other 45% is matchmaking noise \(48 rank readings\)/)).toBeInTheDocument()
    // The canvas is opaque to AT — the caption is the chart's accessible name.
    expect(screen.getByRole('img', { name: /The smoothed line is your estimated true skill/ })).toBeInTheDocument()
  })

  it('refuses a percentage when the variance split saturates', () => {
    renderCurve(skillCurve({ signalShare: 1, saturated: true, n: 14 }))
    expect(screen.getByText(/these 14 readings don't move in a way the filter can separate/)).toBeInTheDocument()
    expect(screen.queryByText(/Skill drift explains/)).not.toBeInTheDocument()
  })

  it.each([
    [0.39, 'most of the jitter you feel is the matchmaker, not you'],
    [0.4, 'roughly an even split between real change and queue variance'],
    [0.7, 'roughly an even split between real change and queue variance'],
    [0.71, 'your rank is tracking real improvement more than luck'],
  ])('reads a %s share in plain terms', (share, plain) => {
    renderCurve(skillCurve({ signalShare: share }))
    expect(screen.getByText(new RegExp(`In plain terms: ${plain}\\.$`))).toBeInTheDocument()
  })

  it('says nothing about a shift when none was detected', () => {
    renderCurve(skillCurve())
    expect(screen.queryByText(/Your win rate shifted around/)).not.toBeInTheDocument()
  })

  it('dates a detected shift, quotes both rates, and never claims causation', () => {
    renderCurve(skillCurve(), shift())
    const line = screen.getByText(/Your win rate shifted around/)
    expect(line).toHaveTextContent('45% → 58% (p = 0.004)')
    expect(line).toHaveTextContent('Correlation, not causation.')
  })

  it('prefers the review habit over a pool change as the correlate', () => {
    renderCurve(skillCurve(), shift({}, { reviewStarted: true, poolEntered: ['juno'], poolLeft: ['ana'] }))
    expect(screen.getByText(/around when you started reviewing games/)).toBeInTheDocument()
  })

  it('names heroes that entered the pool before ones that left it', () => {
    renderCurve(skillCurve(), shift({}, { poolEntered: ['juno', 'kiriko'], poolLeft: ['ana'] }))
    expect(screen.getByText(/around when juno and kiriko entered your pool/)).toBeInTheDocument()

    renderCurve(skillCurve(), shift({}, { poolLeft: ['ana'] }))
    expect(screen.getByText(/around when ana left your pool/)).toBeInTheDocument()
  })

  it('caveats a downward shift as a possible sag toward 50%', () => {
    renderCurve(skillCurve(), shift({ before: { winrate: 58, n: 24 }, after: { winrate: 45, n: 24 }, deltaPts: -13 }))
    expect(screen.getByText(/a long climb sagging toward 50% can read as a downward shift/)).toBeInTheDocument()
  })
})

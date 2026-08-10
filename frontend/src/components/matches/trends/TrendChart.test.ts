import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import { defineComponent, h, nextTick } from 'vue'

import TrendChart from '@/components/matches/trends/TrendChart.vue'
import { lineOption } from '@/components/matches/trends/trend-options'
import { useTheme } from '@/composables/settings/useTheme'

// vue-echarts stands in for the real chart. ECharts paints to a canvas
// happy-dom cannot give it a 2D context for, and the canvas is opaque to every
// query anyway — what this component actually owns is the OPTION it hands
// down, the theme it registers, and the gestures it translates into events.
// The stub records the first and replays the second.
const chart = vi.hoisted(() => ({
  props: null as { option: Record<string, unknown>; theme: string } | null,
  actions: [] as { type?: string; areas?: unknown[]; start?: number; end?: number }[],
  emit: null as ((event: string, payload: unknown) => void) | null,
  // What convertFromPixel reports for a click, and whether it landed in the
  // plot grid (vs the legend / zoom slider).
  coord: [0] as number[],
  inGrid: true,
}))

vi.mock('vue-echarts', async () => {
  const { defineComponent: define, h: createElement } = await import('vue')
  return {
    default: define({
      name: 'VChartStub',
      props: { option: { type: Object, default: () => ({}) }, theme: { type: String, default: '' } },
      emits: ['brush-end', 'datazoom'],
      setup(props, { emit, expose }) {
        chart.props = props as unknown as { option: Record<string, unknown>; theme: string }
        chart.emit = emit as (event: string, payload: unknown) => void
        expose({
          dispatchAction: (action: { type?: string }) => { chart.actions.push(action) },
          convertFromPixel: () => chart.coord,
          containPixel: () => chart.inGrid,
        })
        return () => createElement('div')
      },
    }),
  }
})

// prefers-reduced-motion is read through matchMedia, which also backs the
// fresh-install theme detection — pin both, and keep the change listeners so
// a test can flip the preference mid-session.
const motion = vi.hoisted(() => ({ reduce: false, listeners: new Set<() => void>() }))

function installMatchMedia(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    // A live getter, so flipping the preference mid-test is visible to the
    // listener the component registered at mount.
    get matches() { return query.includes('reduced-motion') ? motion.reduce : true },
    addEventListener: (_: string, fn: () => void) => { motion.listeners.add(fn) },
    removeEventListener: (_: string, fn: () => void) => { motion.listeners.delete(fn) },
  }))
}

// usePersistedRef broadcasts a theme change to sibling instances only after a
// SUCCESSFUL persist, and happy-dom ships no localStorage.
function installLocalStorage(): void {
  const store: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v) },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length },
  })
}

const CAPTION = 'Rank progression over time, by role'

// Two matches an hour apart — enough for "which match is nearest this click?"
const option = lineOption([
  { name: 'Tank', key: 'tank', points: [
    { t: 1000, v: 1, matchKey: 'early-match' },
    { t: 2000, v: 2, matchKey: 'late-match' },
  ] },
])

function renderChart(props: Record<string, unknown> = {}) {
  return render(TrendChart, { props: { option, caption: CAPTION, ...props } })
}

function chartOption(): Record<string, unknown> {
  return chart.props?.option ?? {}
}

function actionTypes(): (string | undefined)[] {
  return chart.actions.map((a) => a.type)
}

function frame(): HTMLElement {
  return screen.getByRole('img', { name: CAPTION })
}

async function clickAt(x: number, y: number, upX = x, upY = y): Promise<void> {
  await fireEvent.pointerDown(frame(), { clientX: x, clientY: y })
  await fireEvent.pointerUp(frame(), { clientX: upX, clientY: upY })
}

beforeEach(() => {
  chart.actions.length = 0
  chart.coord = [0]
  chart.inGrid = true
  motion.reduce = false
  motion.listeners.clear()
  installMatchMedia()
  installLocalStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TrendChart — what the canvas is told', () => {
  it('carries the caption to assistive tech on both the frame and the chart itself', () => {
    renderChart()

    expect(frame()).toBeInTheDocument()
    expect(chartOption().aria).toEqual({ enabled: true, label: { description: CAPTION } })
  })

  it('turns animation off for a reduced-motion viewer, and back on when they change their mind', async () => {
    motion.reduce = true
    const view = renderChart()
    await nextTick()
    expect(chartOption().animation).toBe(false)

    motion.reduce = false
    for (const fn of motion.listeners) fn()
    await nextTick()
    expect(chartOption().animation).toBe(true)

    // The media listener must not outlive the chart.
    view.unmount()
    expect(motion.listeners.size).toBe(0)
  })

  it('names a fresh ECharts theme per palette so the chart re-inits on a theme switch', async () => {
    const Harness = defineComponent({
      setup() {
        const { setTheme } = useTheme()
        return () => h('div', [
          h('button', { onClick: () => setTheme('day') }, 'Use the Day theme'),
          h(TrendChart, { option, caption: CAPTION }),
        ])
      },
    })
    render(Harness)
    expect(chart.props?.theme).toBe('recall-dark')

    await fireEvent.click(screen.getByRole('button', { name: 'Use the Day theme' }))

    expect(chart.props?.theme).toBe('recall-day')
  })
})

describe('TrendChart — brushing a time range', () => {
  it('narrows to the brushed span, in local wall-clock terms, then drops the rectangle', async () => {
    const view = renderChart()
    await nextTick()
    chart.actions.length = 0
    const from = new Date(2026, 4, 3, 9, 5).getTime()
    const to = new Date(2026, 4, 3, 10, 30).getTime()

    // Endpoints arrive in gesture order; a right-to-left drag still reads low → high.
    chart.emit?.('brush-end', { areas: [{ coordRange: [to, from] }] })

    expect(view.emitted()['narrow-range']).toEqual([['2026-05-03T09:05', '2026-05-03T10:30']])
    // The rectangle is stale the moment the set re-narrows.
    expect(chart.actions).toEqual([{ type: 'brush', areas: [] }])
  })

  it('ignores a brush too narrow to mean a range', async () => {
    const view = renderChart()
    const from = new Date(2026, 4, 3, 9, 5).getTime()

    chart.emit?.('brush-end', { areas: [{ coordRange: [from, from + 30_000] }] })
    chart.emit?.('brush-end', { areas: [] })
    await nextTick()

    expect(view.emitted()['narrow-range']).toBeUndefined()
  })
})

describe('TrendChart — the zoom slider', () => {
  it('reports being off the full range, in either event shape', async () => {
    const view = renderChart()

    chart.emit?.('datazoom', { batch: [{ start: 10, end: 90 }] })
    chart.emit?.('datazoom', { start: 0, end: 100 })
    chart.emit?.('datazoom', { start: 0, end: 42 })
    await nextTick()

    expect(view.emitted()['zoom-change']).toEqual([[true], [false], [true]])
  })

  it('treats a hair off either end as still fully zoomed out', async () => {
    const view = renderChart()

    chart.emit?.('datazoom', { batch: [{ start: 0.4, end: 99.6 }] })
    await nextTick()

    expect(view.emitted()['zoom-change']).toEqual([[false]])
  })
})

describe('TrendChart — clicking a point open', () => {
  it('opens the match nearest the click', async () => {
    const view = renderChart()

    chart.coord = [1400]
    await clickAt(20, 20)
    chart.coord = [1900]
    await clickAt(20, 20)

    expect(view.emitted()['open-match']).toEqual([['early-match'], ['late-match']])
  })

  it('leaves a drag to the brush', async () => {
    const view = renderChart()
    chart.coord = [1400]

    await clickAt(20, 20, 40, 40)

    expect(view.emitted()['open-match']).toBeUndefined()
  })

  it('ignores clicks outside the plot grid, where the legend and slider live', async () => {
    const view = renderChart()
    chart.coord = [1400]
    chart.inGrid = false

    await clickAt(20, 20)

    expect(view.emitted()['open-match']).toBeUndefined()
  })

  it('says nothing when the click lands nowhere near a plotted match', async () => {
    const view = render(TrendChart, { props: { option: lineOption([]), caption: CAPTION } })
    chart.coord = [1400]

    await clickAt(20, 20)

    expect(view.emitted()['open-match']).toBeUndefined()
  })
})

describe('TrendChart — interactive vs static charts', () => {
  // Rendered WITHOUT `interactive`, which is the documented default. Vue casts
  // an absent Boolean prop to `false`, so before the withDefaults fix this
  // chart came up static: no brush armed, no click-to-open, no zoom reset.
  it('arms the brush cursor on mount and re-arms it when the option changes', async () => {
    const view = renderChart()
    await nextTick()
    expect(actionTypes()).toEqual(['takeGlobalCursor'])

    await view.rerender({ option: lineOption([{ name: 'DPS', key: 'dps', points: [{ t: 1, v: 1, matchKey: 'x' }] }]) })
    await nextTick()

    expect(actionTypes()).toEqual(['takeGlobalCursor', 'takeGlobalCursor'])
  })

  it('snaps the zoom back and clears the brush when the parent resets the view', async () => {
    const view = renderChart({ resetSignal: 0 })
    await nextTick()
    chart.actions.length = 0

    await view.rerender({ resetSignal: 1 })

    expect(chart.actions).toEqual([
      { type: 'dataZoom', start: 0, end: 100 },
      { type: 'brush', areas: [] },
    ])
  })

  it('leaves a static chart inert — no brush, no click-to-open, no zoom reset', async () => {
    const view = renderChart({ interactive: false, resetSignal: 0 })
    await nextTick()
    chart.coord = [1400]

    await clickAt(20, 20)
    await view.rerender({ interactive: false, resetSignal: 1 })

    expect(chart.actions).toEqual([])
    expect(view.emitted()['open-match']).toBeUndefined()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, type RenderResult } from '@testing-library/vue'
import { computed, nextTick, ref } from 'vue'

import TrendsSection from '@/components/matches/trends/TrendsSection.vue'
import { DOSSIER_KEY } from '@/composables/dashboard/useDossier'
import { NARROW_KEY, type NarrowApi } from '@/composables/matches/useNarrow'
import type { MatchesDossier } from '@/composables/matches/useMatchesDossier'
import type { TrendSeries, RankSeries, WinrateGrid } from '@/match/match-trends-helpers'

// TrendChart wraps ECharts, which paints to a canvas happy-dom can't give it a
// context for — and the canvas is opaque to every query anyway. The stub keeps
// each card's caption in the a11y tree and lets a test replay the gestures the
// real chart emits (brush, zoom, click-to-open).
interface ChartStub {
  props: { caption: string; resetSignal: number; interactive: boolean }
  emit: (event: string, ...args: unknown[]) => void
}
const charts = vi.hoisted(() => ({ list: [] as unknown[] }))

vi.mock('@/components/matches/trends/TrendChart.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    // defineAsyncComponent unwraps `.default` only from something that looks
    // like an ES module namespace.
    __esModule: true,
    default: defineComponent({
      name: 'TrendChartStub',
      props: {
        option: { type: Object, default: () => ({}) },
        caption: { type: String, default: '' },
        resetSignal: { type: Number, default: 0 },
        interactive: { type: Boolean, default: true },
      },
      emits: ['open-match', 'narrow-range', 'zoom-change'],
      setup(props, { emit }) {
        charts.list.push({ props, emit })
        return () => h('div', { role: 'img', 'aria-label': props.caption })
      },
    }),
  }
})

function chartFor(caption: RegExp): ChartStub {
  const found = (charts.list as ChartStub[]).find((c) => caption.test(c.props.caption))
  if (!found) throw new Error(`no chart matching ${String(caption)}`)
  return found
}

// ─── Fixtures ──────────────────────────────────────────────────────

function series(name: string, key: string): TrendSeries {
  return { name, key, points: [{ t: 1000, v: 50, matchKey: 'm1' }, { t: 2000, v: 60, matchKey: 'm2' }] }
}

const rankSeries: RankSeries[] = [{
  key: 'tank', label: 'Tank',
  points: [{ t: 1000, score: 12, tier: 'gold', level: 3, progress: 0, change: 2, matchKey: 'm1' }],
}]

const grid: WinrateGrid = {
  dayLabels: ['Sun'], bucketLabels: ['00–04'],
  cells: [{ x: 0, y: 0, wins: 1, total: 2, winRate: 50 }],
}

const EMPTY_GRID: WinrateGrid = { dayLabels: [], bucketLabels: [], cells: [] }

interface TrendsOverride {
  rankLadder?: RankSeries[]
  rollingWinrate?: TrendSeries[]
  combat?: TrendSeries[]
  bestTimes?: WinrateGrid
}

function fakeDossier(over: TrendsOverride = {}): MatchesDossier {
  const list = (v: TrendSeries[] | undefined) => computed(() => v ?? [])
  return {
    rankLadder: computed(() => over.rankLadder ?? []),
    rankDelta: list([]),
    cumulativeNet: list([]),
    modifierFrequency: list([]),
    combat: list(over.combat),
    rollingWinrate: () => list(over.rollingWinrate),
    heroRollingWinrate: () => list([]),
    mapRollingWinrate: () => list([]),
    dayTimeWinrate: () => computed(() => over.bestTimes ?? EMPTY_GRID),
  } as unknown as MatchesDossier
}

function fakeNarrow(): NarrowApi {
  return {
    customFrom: ref(''), customTo: ref(''),
    customFromTime: ref('12:00'), customToTime: ref('18:00'),
    pickedRange: ref('all'),
  } as unknown as NarrowApi
}

// The whole section is one populated set unless a test says otherwise.
const populated: TrendsOverride = {
  rankLadder: rankSeries,
  rollingWinrate: [series('Tank', 'tank')],
  combat: [series('Eliminations', 'eliminations')],
  bestTimes: grid,
}

// The async TrendChart chunk resolves on a macrotask, so a render isn't
// settled by nextTick alone.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function renderTrends(over: TrendsOverride = populated, narrow: NarrowApi = fakeNarrow()): {
  view: RenderResult
  narrow: NarrowApi
} {
  const view = render(TrendsSection, {
    global: {
      provide: {
        [DOSSIER_KEY as symbol]: fakeDossier(over),
        [NARROW_KEY as symbol]: narrow,
      },
    },
  })
  return { view, narrow }
}

async function open(over: TrendsOverride = populated, narrow: NarrowApi = fakeNarrow()) {
  const rendered = renderTrends(over, narrow)
  await fireEvent.click(screen.getByRole('button', { name: /^Trends/ }))
  await settle()
  return rendered
}

function cardTitles(): string[] {
  return screen.queryAllByRole('heading', { level: 4 }).map((h) => h.textContent?.trim() ?? '')
}

beforeEach(() => {
  charts.list.length = 0
})

describe('TrendsSection — opening the section', () => {
  it('stays collapsed until asked, so the ECharts chunk is never loaded on arrival', async () => {
    renderTrends()
    const toggle = screen.getByRole('button', { name: /^Trends/ })

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(cardTitles()).toEqual([])
    expect(screen.queryByRole('button', { name: 'Reset view' })).not.toBeInTheDocument()

    await fireEvent.click(toggle)
    await settle()

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(cardTitles()).toContain('Rank over time')
  })

  it('explains an undated set instead of drawing eight blank charts', async () => {
    await open({})

    expect(screen.getByText(/No matches with a known date in this set/)).toBeInTheDocument()
    expect(cardTitles()).toEqual([])
  })

  it('gives a chart with no readings its own reason, and draws the ones that have data', async () => {
    await open({ rollingWinrate: [series('Tank', 'tank')] })

    expect(screen.getByText(/No rank readings — capture a competitive rank screenshot to track your climb/))
      .toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Rolling win rate over the last 20 matches, by role/ }))
      .toBeInTheDocument()
  })
})

describe('TrendsSection — arranging the charts', () => {
  it('hides "Modifiers over time" by default and offers it back as a chip', async () => {
    await open()

    expect(cardTitles()).not.toContain('Modifiers over time')
    expect(screen.getByRole('button', { name: '+ Modifiers over time' })).toBeInTheDocument()
  })

  it('removes a chart to the add row, and re-adds it at the end', async () => {
    await open()

    await fireEvent.click(screen.getByRole('button', { name: 'Remove the Rank over time chart' }))
    expect(cardTitles()).not.toContain('Rank over time')

    await fireEvent.click(screen.getByRole('button', { name: '+ Rank over time' }))
    await settle()

    expect(cardTitles().at(-1)).toBe('Rank over time')
    expect(screen.queryByRole('button', { name: '+ Rank over time' })).not.toBeInTheDocument()
  })

  it('reorders a chart from its grip with the arrow keys', async () => {
    await open()
    const [first, second] = cardTitles()

    await fireEvent.keyDown(
      screen.getByRole('button', { name: `Reorder the ${first} chart. Use arrow keys to move it.` }),
      { key: 'ArrowRight' },
    )

    expect(cardTitles().slice(0, 2)).toEqual([second, first])
  })

  it('reorders a chart by dragging its grip onto another card', async () => {
    await open()
    const [first, second, third] = cardTitles()
    // Only the grip is draggable; the card body stays free for the canvas brush.
    const grip = screen.getByRole('button', { name: `Reorder the ${first} chart. Use arrow keys to move it.` })
    const target = screen.getByRole('heading', { level: 4, name: third ?? '' })
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), setDragImage: vi.fn() }

    await fireEvent.dragStart(grip, { dataTransfer })
    await fireEvent.dragOver(target, { dataTransfer })
    await fireEvent.drop(target, { dataTransfer })

    // Dropping "on" a card means inserting before it — after the source is
    // spliced out, that lands the dragged chart in the target's old slot.
    expect(cardTitles().slice(0, 3)).toEqual([second, first, third])
    expect(dataTransfer.setDragImage).toHaveBeenCalled()
  })

  it('leaves the order alone when a drag is abandoned instead of dropped', async () => {
    await open()
    const before = cardTitles()
    const grip = screen.getByRole('button', { name: `Reorder the ${before[0]} chart. Use arrow keys to move it.` })
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), setDragImage: vi.fn() }

    await fireEvent.dragStart(grip, { dataTransfer })
    await fireEvent.dragEnd(grip, { dataTransfer })
    // A drop landing after the gesture was abandoned must be inert.
    await fireEvent.drop(screen.getByRole('heading', { level: 4, name: before[2] ?? '' }), { dataTransfer })

    expect(cardTitles()).toEqual(before)
  })

  it('offers a way back when every chart has been removed', async () => {
    await open()

    for (const title of cardTitles()) {
      await fireEvent.click(screen.getByRole('button', { name: `Remove the ${title} chart` }))
    }

    expect(screen.getByText('All charts hidden — add one below.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Rank over time' })).toBeInTheDocument()
  })

  it('leaves the first chart put when it is already first', async () => {
    await open()
    const before = cardTitles()

    await fireEvent.keyDown(
      screen.getByRole('button', { name: `Reorder the ${before[0]} chart. Use arrow keys to move it.` }),
      { key: 'ArrowLeft' },
    )

    expect(cardTitles()).toEqual(before)
  })
})

describe('TrendsSection — the rolling window', () => {
  it('re-describes every rolling chart when the window changes', async () => {
    await open()
    expect(screen.getByRole('img', { name: /last 20 matches, by role/ })).toBeInTheDocument()

    await fireEvent.update(screen.getByLabelText('Rolling window'), '50')
    await settle()

    expect(screen.getByRole('img', { name: /last 50 matches, by role/ })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /last 20 matches, by role/ })).not.toBeInTheDocument()
  })
})

describe('TrendsSection — brushing and resetting', () => {
  it('scopes the whole workspace to a range brushed on a chart', async () => {
    const { narrow } = await open()

    chartFor(/Rank progression/).emit('narrow-range', '2026-05-03T09:05', '2026-05-03T10:30')
    await nextTick()

    expect(narrow.customFrom.value).toBe('2026-05-03T09:05')
    expect(narrow.customTo.value).toBe('2026-05-03T10:30')
    // A viz pick is whole-day: the panel's minute bounds have to go.
    expect(narrow.customFromTime.value).toBe('')
    expect(narrow.customToTime.value).toBe('')
    expect(narrow.pickedRange.value).toBe('custom')
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeEnabled()
  })

  it('keeps "Reset view" disabled until a chart is actually zoomed', async () => {
    await open()
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeDisabled()

    chartFor(/Rank progression/).emit('zoom-change', true)
    await nextTick()
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeEnabled()

    // Zooming back out by hand takes the last reason to reset away again.
    chartFor(/Rank progression/).emit('zoom-change', false)
    await nextTick()
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeDisabled()
  })

  it('resets every chart and drops the brushed range in one click', async () => {
    const { narrow } = await open()
    const chart = chartFor(/Rank progression/)
    const before = chart.props.resetSignal
    chart.emit('narrow-range', '2026-05-03T09:05', '2026-05-03T10:30')
    chart.emit('zoom-change', true)
    await nextTick()

    await fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))
    await nextTick()

    expect(chart.props.resetSignal).toBe(before + 1)
    expect(narrow.customFrom.value).toBe('')
    expect(narrow.customTo.value).toBe('')
    expect(narrow.pickedRange.value).toBe('all')
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeDisabled()
  })

  it('passes a click on a chart point up to the workspace', async () => {
    const { view } = await open()

    chartFor(/Rank progression/).emit('open-match', 'match-42')

    expect(view.emitted()['open-match']).toEqual([['match-42']])
  })

  it('opts the static day×time heatmap out of the timeline gestures', async () => {
    await open()

    expect(chartFor(/Win rate by day of week/).props.interactive).toBe(false)
    expect(chartFor(/Rank progression/).props.interactive).toBe(true)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEvent, fireEvent, render, screen } from '@testing-library/vue'

import MatchesDossierSections from '@/components/matches/dossier/MatchesDossierSections.vue'
import { _resetSectionLayoutForTest } from '@/composables/matches/dossier/useSectionLayout'

// The full-width bands below the dossier grid are user-orderable and
// user-removable, and each band is a heavyweight surface of its own. This
// suite is about the CONTAINER: which band answers to which section id,
// the mouse + keyboard reorder state machine (including the no-op edges
// that would otherwise scramble the layout), the renumbering that keeps
// the grips' keyboard bounds honest, and the two events the bands route
// up to MatchesView. The bands themselves are stubbed so a failure here
// can only mean the container broke.

function stubBand(label: string, event?: string, payload?: unknown) {
  return async () => {
    const { defineComponent, h } = await import('vue')
    return {
      default: defineComponent({
        name: `${label}Stub`,
        inheritAttrs: false,
        emits: event ? [event] : [],
        setup(_props, { emit }) {
          return () => h('button', {
            type: 'button',
            onClick: () => { if (event) emit(event, payload) },
          }, label)
        },
      }),
    }
  }
}

vi.mock('@/components/matches/timeline/MatchTimelineHeader.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'MatchTimelineHeaderStub',
      inheritAttrs: false,
      emits: ['update:filterFrom', 'update:filterTo'],
      setup(_props, { emit }) {
        return () => h('div', [
          h('button', { type: 'button', onClick: () => emit('update:filterFrom', '2026-05-01') }, 'brush from'),
          h('button', { type: 'button', onClick: () => emit('update:filterTo', '2026-05-31') }, 'brush to'),
        ])
      },
    }),
  }
})
vi.mock('@/components/matches/dossier/MatchMapRoleBand.vue', stubBand('Geography band'))
vi.mock('@/components/matches/dossier/MatchHeroModeBand.vue', stubBand('Hero mode band', 'open-match', 'match-1'))
vi.mock('@/components/matches/dossier/MatchHeroPoolBand.vue', stubBand('Hero pool band'))

// happy-dom's localStorage is a no-op, so the persisted section layout
// would never round-trip a reorder without this.
function installLocalStorageShim(): void {
  const storage: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem:    (k: string) => storage[k] ?? null,
    setItem:    (k: string, v: string) => { storage[k] = String(v) },
    removeItem: (k: string) => { delete storage[k] },
    clear:      () => { for (const k of Object.keys(storage)) delete storage[k] },
    key:        (i: number) => Object.keys(storage)[i] ?? null,
    get length() { return Object.keys(storage).length },
  })
}

beforeEach(() => {
  installLocalStorageShim()
  _resetSectionLayoutForTest()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderSections() {
  return render(MatchesDossierSections, {
    props: { records: [], filterFrom: '', filterTo: '' },
  })
}

const gripLabels = () =>
  screen.getAllByRole('button', { name: /^Reorder / }).map((b) => b.getAttribute('aria-label') ?? '')
const order = () => gripLabels().map((l) => l.replace(/^Reorder (.+) \(\d+ of \d+\).*$/, '$1'))
const positions = () => gripLabels().map((l) => l.replace(/^Reorder .+ \((\d+ of \d+)\).*$/, '$1'))
const grip = (label: string) => screen.getByRole('button', { name: new RegExp(`^Reorder ${label} `) })

const DRAG_INIT = { dataTransfer: { effectAllowed: '', setData: vi.fn() } }

describe('MatchesDossierSections — what renders', () => {
  it('installs all four bands in registry order, each in its own reorder chrome', () => {
    renderSections()
    expect(order()).toEqual(['Campaign Log', 'Geography', 'Hero × Game-Mode', 'Hero Pool'])
    expect(positions()).toEqual(['1 of 4', '2 of 4', '3 of 4', '4 of 4'])
    expect(screen.getByText('brush from')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Geography band' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hero mode band' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hero pool band' })).toBeInTheDocument()
  })

  it('removing a section drops its band AND renumbers the survivors', async () => {
    renderSections()
    await fireEvent.click(screen.getByRole('button', { name: 'Remove Geography' }))

    expect(order()).toEqual(['Campaign Log', 'Hero × Game-Mode', 'Hero Pool'])
    expect(positions()).toEqual(['1 of 3', '2 of 3', '3 of 3'])
    expect(screen.queryByRole('button', { name: 'Geography band' })).not.toBeInTheDocument()
  })
})

describe('MatchesDossierSections — keyboard reorder', () => {
  it('ArrowDown on a grip swaps the section with the one below it', async () => {
    renderSections()
    await fireEvent.keyDown(grip('Campaign Log'), { key: 'ArrowDown' })
    expect(order()).toEqual(['Geography', 'Campaign Log', 'Hero × Game-Mode', 'Hero Pool'])
  })

  it('ArrowUp moves it back — the two directions are symmetric', async () => {
    renderSections()
    await fireEvent.keyDown(grip('Hero Pool'), { key: 'ArrowUp' })
    expect(order()).toEqual(['Campaign Log', 'Geography', 'Hero Pool', 'Hero × Game-Mode'])
  })

  it('does nothing at either end instead of wrapping around', async () => {
    renderSections()
    await fireEvent.keyDown(grip('Campaign Log'), { key: 'ArrowUp' })
    await fireEvent.keyDown(grip('Hero Pool'), { key: 'ArrowDown' })
    expect(order()).toEqual(['Campaign Log', 'Geography', 'Hero × Game-Mode', 'Hero Pool'])
  })
})

describe('MatchesDossierSections — drag reorder', () => {
  it('drags a section onto another and lands it in that slot', async () => {
    renderSections()
    await fireEvent.dragStart(grip('Hero Pool'), DRAG_INIT)
    await fireEvent.dragOver(grip('Campaign Log'))
    await fireEvent.drop(grip('Campaign Log'))

    expect(order()).toEqual(['Hero Pool', 'Campaign Log', 'Geography', 'Hero × Game-Mode'])
  })

  it('stamps the drag payload Firefox refuses to drag without', async () => {
    renderSections()
    const setData = vi.fn()
    const dragStart = createEvent.dragStart(grip('Geography'))
    Object.defineProperty(dragStart, 'dataTransfer', {
      value: { effectAllowed: 'none', setData },
    })
    await fireEvent(grip('Geography'), dragStart)

    expect(setData).toHaveBeenCalledWith('text/plain', 'geography')
    expect((dragStart as DragEvent).dataTransfer?.effectAllowed).toBe('move')
  })

  it('dropping a section on itself leaves the order untouched', async () => {
    renderSections()
    await fireEvent.dragStart(grip('Geography'), DRAG_INIT)
    await fireEvent.drop(grip('Geography'))
    expect(order()).toEqual(['Campaign Log', 'Geography', 'Hero × Game-Mode', 'Hero Pool'])
  })

  it('a drop with no drag in flight is ignored', async () => {
    renderSections()
    await fireEvent.drop(grip('Hero Pool'))
    expect(order()).toEqual(['Campaign Log', 'Geography', 'Hero × Game-Mode', 'Hero Pool'])
  })

  it('dragend cancels the drag, so a later drop does not move anything', async () => {
    renderSections()
    await fireEvent.dragStart(grip('Hero Pool'), DRAG_INIT)
    await fireEvent.dragEnd(grip('Hero Pool'))
    await fireEvent.drop(grip('Campaign Log'))
    expect(order()).toEqual(['Campaign Log', 'Geography', 'Hero × Game-Mode', 'Hero Pool'])
  })
})

describe('MatchesDossierSections — events routed up to the view', () => {
  it('forwards the Campaign Log brush as both range bounds', async () => {
    const { emitted } = renderSections()
    await fireEvent.click(screen.getByRole('button', { name: 'brush from' }))
    await fireEvent.click(screen.getByRole('button', { name: 'brush to' }))

    expect(emitted()['update:filterFrom']).toEqual([['2026-05-01']])
    expect(emitted()['update:filterTo']).toEqual([['2026-05-31']])
  })

  it('forwards the Hero × Game-Mode band\'s drill-through match key', async () => {
    const { emitted } = renderSections()
    await fireEvent.click(screen.getByRole('button', { name: 'Hero mode band' }))
    expect(emitted()['open-match']).toEqual([['match-1']])
  })
})

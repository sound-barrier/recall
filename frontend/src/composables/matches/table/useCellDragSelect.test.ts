import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { fireEvent, render, screen } from '@testing-library/vue'

import { useCellDragSelect } from '@/composables/matches/table/useCellDragSelect'
import type { TableSortCol } from '@/composables/matches/table/useTableSort'
import type { MatchRecord } from '@/api-client'

const COLS: readonly TableSortCol[] = ['map', 'result']
const heroRole = () => 'damage'

const RECORDS: MatchRecord[] = [
  { match_key: 'k0', data: { map: 'Rialto', result: 'victory' } },
  { match_key: 'k1', data: { map: 'Ilios', result: 'defeat' } },
  { match_key: 'k2', data: { map: 'Busan', result: 'draw' } },
] as unknown as MatchRecord[]

// A stand-in for MatchesTable: the scroll pane owns the mousedown, the
// rows carry data-match-key, the cells data-col, and a row click routes
// through onRowOpen — the exact wiring the real shell binds. Each cell
// renders a unique label so tests can address it by visible text.
function mountTable(opts: { withButtonCell?: boolean; onError?: (m: string) => void } = {}) {
  let api!: ReturnType<typeof useCellDragSelect>
  const opened: string[] = []
  const Comp = defineComponent({
    setup() {
      const containerRef = ref<HTMLElement | null>(null)
      api = useCellDragSelect({
        rows: ref(RECORDS),
        cols: COLS,
        heroRole,
        containerRef,
        onOpen: (key) => { opened.push(key) },
        onError: opts.onError,
      })
      return () => h('div', { ref: containerRef, onMousedown: api.onCellMouseDown }, [
        h('table', [
          // The sortable header row carries no data-col — a press there
          // sorts, it never starts a cell selection.
          h('thead', [h('tr', COLS.map((col) => h('th', { scope: 'col' }, col)))]),
          h('tbody', RECORDS.map((rec) => h(
            'tr',
            {
              'data-match-key': rec.match_key,
              onClick: () => { api.onRowOpen(rec.match_key) },
            },
            COLS.map((_, col) => h('td', { 'data-col': col }, [
              opts.withButtonCell && col === 1
                ? h('button', { type: 'button' }, `${rec.match_key}c${col}`)
                : `${rec.match_key}c${col}`,
            ])),
          ))),
        ]),
      ])
    },
  })
  const view = render(Comp)
  return { api, opened, view }
}

const cell = (key: string, col: number) => screen.getByText(`${key}c${col}`)

// Mouse gestures land on the cell (they bubble to the pane's mousedown
// and to the document-level move/up listeners the composable installs),
// mirroring how a real pointer drag reaches this code.
async function mouseDownOn(el: Element, x = 10, y = 10) {
  await fireEvent.mouseDown(el, { button: 0, clientX: x, clientY: y, bubbles: true })
}
async function mouseMoveOn(el: Element, x: number, y: number) {
  await fireEvent.mouseMove(el, { clientX: x, clientY: y, bubbles: true })
}

let rafCallbacks: FrameRequestCallback[]
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  rafCallbacks = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => { vi.restoreAllMocks() })

function flushRaf() {
  const pending = rafCallbacks.slice()
  rafCallbacks = []
  for (const cb of pending) cb(performance.now())
}

describe('useCellDragSelect — click vs drag', () => {
  it('a click without movement still opens the row', async () => {
    const { api, opened } = mountTable()
    await mouseDownOn(cell('k1', 0))
    await fireEvent.mouseUp(document)
    await fireEvent.click(cell('k1', 0))

    expect(api.cellSel.hasSelection.value).toBe(false)
    expect(opened).toEqual(['k1'])
  })

  it('a sub-threshold jitter is still a click, not a drag', async () => {
    const { api, opened } = mountTable()
    await mouseDownOn(cell('k1', 0), 10, 10)
    await mouseMoveOn(cell('k1', 0), 12, 11) // |dx|+|dy| = 3 < 4
    await fireEvent.mouseUp(document)
    await fireEvent.click(cell('k1', 0))

    expect(api.cellSel.hasSelection.value).toBe(false)
    expect(opened).toEqual(['k1'])
  })

  it('a drag selects the rectangle and swallows exactly one row-open', async () => {
    const { api, opened } = mountTable()
    await mouseDownOn(cell('k0', 0), 10, 10)
    await mouseMoveOn(cell('k2', 1), 90, 90)
    await fireEvent.mouseUp(document)
    // The mouseup lands on a row; without the suppression the drag would
    // ALSO open the detail panel over the fresh selection.
    await fireEvent.click(cell('k2', 1))

    expect(api.cellSel.selectedColsFor('k1')).toEqual([0, 1])
    expect(opened).toEqual([])

    // Suppression is one-shot: the next deliberate click opens as usual.
    await fireEvent.click(cell('k2', 1))
    expect(opened).toEqual(['k2'])
  })

  it('ignores a non-primary button (right-click opens the context menu)', async () => {
    const { api } = mountTable()
    await fireEvent.mouseDown(cell('k0', 0), { button: 2, clientX: 10, clientY: 10 })
    await mouseMoveOn(cell('k2', 1), 90, 90)

    expect(api.cellSel.hasSelection.value).toBe(false)
  })

  it('never starts a drag from a column header', async () => {
    const { api } = mountTable()
    await mouseDownOn(screen.getByRole('columnheader', { name: 'map' }), 10, 10)
    await mouseMoveOn(cell('k2', 1), 90, 90)

    expect(api.cellSel.hasSelection.value).toBe(false)
  })

  it('never starts a drag from an interactive child', async () => {
    const { api } = mountTable({ withButtonCell: true })
    await mouseDownOn(screen.getByRole('button', { name: 'k0c1' }), 10, 10)
    await mouseMoveOn(cell('k2', 0), 90, 90)

    expect(api.cellSel.hasSelection.value).toBe(false)
  })
})

describe('useCellDragSelect — edge auto-scroll', () => {
  it('scrolls the pane and extends the selection to whatever slides under the pointer', async () => {
    const { api, view } = mountTable()
    // eslint-disable-next-line testing-library/no-node-access -- the scroll pane is the composable's containerRef, not a queryable control
    const pane = view.container.firstElementChild as HTMLElement
    Object.defineProperty(pane, 'getBoundingClientRect', {
      value: () => ({ top: 0, bottom: 200, left: 0, right: 300, width: 300, height: 200, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
    pane.scrollTop = 0

    await mouseDownOn(cell('k0', 0), 10, 10)
    await mouseMoveOn(cell('k0', 1), 60, 190) // drag started, pointer in the bottom edge band
    await mouseMoveOn(cell('k0', 1), 60, 190) // second move takes the dragging branch → schedules the RAF

    // Whatever is under the held pointer after the nudge — here row k2.
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(cell('k2', 1))
    flushRaf()

    expect(pane.scrollTop).toBeGreaterThan(0)
    expect(api.cellSel.selectedColsFor('k2')).toEqual([0, 1])
  })

  it('scrolls the other way at the top edge, and holds the selection when the pointer is over a gap', async () => {
    const { api, view } = mountTable()
    // eslint-disable-next-line testing-library/no-node-access -- see above
    const pane = view.container.firstElementChild as HTMLElement
    Object.defineProperty(pane, 'getBoundingClientRect', {
      value: () => ({ top: 0, bottom: 200, left: 0, right: 300, width: 300, height: 200, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
    pane.scrollTop = 100

    await mouseDownOn(cell('k1', 1), 60, 60)
    await mouseMoveOn(cell('k1', 0), 60, 8) // drag started, pointer in the top edge band
    await mouseMoveOn(cell('k1', 0), 60, 8)

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null) // nothing under the pointer
    flushRaf()

    expect(pane.scrollTop).toBeLessThan(100)
    expect(api.cellSel.selectedColsFor('k1')).toEqual([0, 1]) // unchanged by the empty hit-test
  })

  it('stops the scroll loop as soon as the pointer leaves the edge band', async () => {
    const { view } = mountTable()
    // eslint-disable-next-line testing-library/no-node-access -- see above
    const pane = view.container.firstElementChild as HTMLElement
    Object.defineProperty(pane, 'getBoundingClientRect', {
      value: () => ({ top: 0, bottom: 200, left: 0, right: 300, width: 300, height: 200, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
    pane.scrollTop = 0

    await mouseDownOn(cell('k0', 0), 10, 10)
    await mouseMoveOn(cell('k0', 1), 60, 100) // dead center — no edge
    await mouseMoveOn(cell('k0', 1), 60, 100)
    flushRaf()

    expect(pane.scrollTop).toBe(0)
    expect(rafCallbacks).toHaveLength(0) // loop not re-armed
  })
})

describe('useCellDragSelect — keyboard', () => {
  async function dragSelection() {
    const mounted = mountTable()
    await mouseDownOn(cell('k0', 0), 10, 10)
    await mouseMoveOn(cell('k1', 1), 90, 90)
    await fireEvent.mouseUp(document)
    return mounted
  }

  it('Ctrl+C copies the selected rectangle as TSV', async () => {
    await dragSelection()
    const e = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(e)

    expect(e.defaultPrevented).toBe(true)
    expect(writeText).toHaveBeenCalledWith('Rialto\tvictory\nIlios\tdefeat')
  })

  it('leaves Ctrl+C alone while the caret is in a text field', async () => {
    await dragSelection()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }))
    expect(writeText).not.toHaveBeenCalled()
    input.remove()
  })

  it('Escape clears the selection', async () => {
    const { api } = await dragSelection()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(api.cellSel.hasSelection.value).toBe(false)
  })

  it('ignores the copy key when nothing is selected', () => {
    mountTable()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }))

    expect(writeText).not.toHaveBeenCalled()
  })

  it('removes the document keydown listener on unmount', async () => {
    const { view } = await dragSelection()
    view.unmount()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }))

    expect(writeText).not.toHaveBeenCalled()
  })
})

// A denied clipboard is the ONE failure a user can actually provoke here
// (Firefox and Safari gate writeText behind a permission, and a headless
// browser denies it outright). Every other clipboard caller in the app
// funnels the rejection into the error banner; this one used to `void`
// the promise, which in a browser is an unhandled rejection and, to the
// user, a Ctrl+C that silently did nothing.
describe('useCellDragSelect — clipboard denial', () => {
  it('reports a rejected copy instead of swallowing the rejection', async () => {
    const onError = vi.fn()
    const mounted = mountTable({ onError })
    await mouseDownOn(cell('k0', 0), 10, 10)
    await mouseMoveOn(cell('k1', 1), 90, 90)
    await fireEvent.mouseUp(document)

    writeText.mockRejectedValueOnce(new Error('clipboard write denied'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 0))

    expect(onError).toHaveBeenCalledTimes(1)
    expect(String(onError.mock.calls[0]?.[0])).toMatch(/clipboard write denied/)
    expect(mounted).toBeTruthy()
  })
})

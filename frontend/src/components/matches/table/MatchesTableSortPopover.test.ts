import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import MatchesTableSortPopover from '@/components/matches/table/MatchesTableSortPopover.vue'

// happy-dom has no global localStorage; stub an in-memory one so the
// dialog's own useTableSort instance can read + persist the stack.
let storage: Record<string, string>
beforeEach(() => {
  storage = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value },
    removeItem: (key: string) => { delete storage[key] },
    clear: () => { storage = {} },
  })
})
afterEach(() => vi.unstubAllGlobals())

const ANCHOR = { top: 100, bottom: 120, left: 40, right: 200, width: 160, height: 20 } as DOMRect

// The dialog teleports to <body>, so queries run through screen.
function renderPopover(open = true) {
  return render(MatchesTableSortPopover, { props: { open, anchor: ANCHOR } })
}

const levels = () => screen.queryAllByRole('combobox')
const addLevel = () => screen.getByRole('button', { name: /Add level/ })

describe('MatchesTableSortPopover', () => {
  it('renders nothing until open', () => {
    renderPopover(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the single date-descending default level when open', () => {
    renderPopover(true)
    expect(screen.getByRole('dialog', { name: 'Custom sort for the match table' })).toBeInTheDocument()
    expect(levels()).toHaveLength(1)
    expect(screen.getByRole('combobox', { name: 'Sort column for level 1' })).toHaveValue('date')
    expect(screen.getByRole('button', { name: /Toggle direction for level 1/ })).toHaveTextContent('Desc')
  })

  it('Add level appends a level and disables reorder at the ends', async () => {
    const user = userEvent.setup()
    renderPopover(true)
    await user.click(addLevel())
    expect(levels()).toHaveLength(2)
    // First level can't move up; last can't move down.
    expect(screen.getAllByRole('button', { name: 'Move level up' })[0]).toBeDisabled()
    const downs = screen.getAllByRole('button', { name: 'Move level down' })
    expect(downs[downs.length - 1]).toBeDisabled()
  })

  it('disables Add level once every column is a sort level', async () => {
    const user = userEvent.setup()
    renderPopover(true)
    for (let i = 0; i < 14; i++) {
      const add = addLevel()
      if ((add as HTMLButtonElement).disabled) break
      await user.click(add)
    }
    // One sort level per sortable column (TABLE_SORT_COLUMNS): When,
    // Map, Mode, Queue, Hero, Role, E, A, D, Tags, Edited, User entered,
    // Result.
    expect(levels()).toHaveLength(13)
    expect(addLevel()).toBeDisabled()
  })

  it('toggling a level’s direction flips its label', async () => {
    const user = userEvent.setup()
    renderPopover(true)
    const dir = () => screen.getByRole('button', { name: /Toggle direction for level 1/ })
    expect(dir()).toHaveTextContent('Desc')
    await user.click(dir())
    expect(dir()).toHaveTextContent('Asc')
  })

  it('Reset returns to the single date-descending default', async () => {
    const user = userEvent.setup()
    renderPopover(true)
    await user.click(addLevel())
    expect(levels()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(levels()).toHaveLength(1)
    expect(screen.getByRole('combobox', { name: 'Sort column for level 1' })).toHaveValue('date')
  })

  it('removing the last level shows the empty hint', async () => {
    const user = userEvent.setup()
    renderPopover(true)
    await user.click(screen.getByRole('button', { name: 'Remove level 1' }))
    expect(levels()).toHaveLength(0)
    expect(screen.getByText(/No sort levels — add one below/)).toBeInTheDocument()
  })

  it('emits close when the close button is clicked', async () => {
    const user = userEvent.setup()
    const { emitted } = renderPopover(true)
    await user.click(screen.getByRole('button', { name: 'Close custom sort' }))
    expect(emitted('close')).toBeTruthy()
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import MatchesTableSortPopover from '@/components/matches/MatchesTableSortPopover.vue'

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

function mountPopover(open = true) {
  return mount(MatchesTableSortPopover, {
    props: { open, anchor: ANCHOR },
    // Stub Teleport so the dialog body renders inline in the wrapper.
    global: { stubs: { teleport: true } },
  })
}

const isDisabled = (el: Element | undefined) => (el as HTMLButtonElement | undefined)?.disabled

describe('MatchesTableSortPopover', () => {
  it('renders nothing until open', () => {
    const w = mountPopover(false)
    expect(w.find('[data-testid="table-sort-popover"]').exists()).toBe(false)
  })

  it('renders the single date-descending default level when open', () => {
    const w = mountPopover(true)
    expect(w.find('[data-testid="table-sort-popover"]').exists()).toBe(true)
    const levels = w.findAll('[data-sort-level]')
    expect(levels).toHaveLength(1)
    expect((w.find('[data-level-col]').element as HTMLSelectElement).value).toBe('date')
    expect(w.find('[data-level-dir]').text()).toContain('Desc')
  })

  it('Add level appends a level and disables reorder at the ends', async () => {
    const w = mountPopover(true)
    await w.find('[data-add-level]').trigger('click')
    expect(w.findAll('[data-sort-level]')).toHaveLength(2)
    // First level can't move up; last can't move down.
    expect(isDisabled(w.findAll('[data-level-up]')[0]?.element)).toBe(true)
    const downs = w.findAll('[data-level-down]')
    expect(isDisabled(downs[downs.length - 1]?.element)).toBe(true)
  })

  it('disables Add level once every column is a sort level', async () => {
    const w = mountPopover(true)
    for (let i = 0; i < 14; i++) {
      const add = w.find('[data-add-level]')
      if (isDisabled(add.element)) break
      await add.trigger('click')
    }
    // One sort level per sortable column (TABLE_SORT_COLUMNS): When,
    // Map, Mode, Hero, Role, E/A/D, Tags, Edited, User entered, Result.
    expect(w.findAll('[data-sort-level]')).toHaveLength(10)
    expect(isDisabled(w.find('[data-add-level]').element)).toBe(true)
  })

  it('toggling a level’s direction flips its label', async () => {
    const w = mountPopover(true)
    expect(w.find('[data-level-dir]').text()).toContain('Desc')
    await w.find('[data-level-dir]').trigger('click')
    expect(w.find('[data-level-dir]').text()).toContain('Asc')
  })

  it('Reset returns to the single date-descending default', async () => {
    const w = mountPopover(true)
    await w.find('[data-add-level]').trigger('click')
    expect(w.findAll('[data-sort-level]')).toHaveLength(2)
    await w.find('[data-clear-sort]').trigger('click')
    expect(w.findAll('[data-sort-level]')).toHaveLength(1)
    expect((w.find('[data-level-col]').element as HTMLSelectElement).value).toBe('date')
  })

  it('removing the last level shows the empty hint', async () => {
    const w = mountPopover(true)
    await w.find('[data-level-remove]').trigger('click')
    expect(w.findAll('[data-sort-level]')).toHaveLength(0)
    expect(w.find('[data-sort-empty]').exists()).toBe(true)
  })

  it('emits close when the close button is clicked', async () => {
    const w = mountPopover(true)
    await w.find('.tsp-close').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })
})

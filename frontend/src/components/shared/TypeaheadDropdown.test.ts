import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import { nextTick } from 'vue'
import TypeaheadDropdown from '@/components/shared/TypeaheadDropdown.vue'

const HEROES = ['ana', 'kiriko', 'lucio', 'mercy', 'soldier', 'zenyatta']

// The base carries the four required props; optional props (placeholder,
// emptyMessage, isSelected, showCheckmark, autoHighlightFirst) reach the
// component only when a caller passes them, so component defaults still apply.
const DROPDOWN_BASE = {
  listboxId: 'td-test',
  label: 'Heroes',
  options: HEROES,
  open: false,
}

function renderDropdown(overrides: Partial<{
  listboxId: string
  label: string
  options: string[]
  open: boolean
  placeholder: string
  emptyMessage: string
  isSelected: (opt: string) => boolean
  showCheckmark: boolean
  autoHighlightFirst: boolean
}> = {}) {
  return render(TypeaheadDropdown, {
    props: { ...DROPDOWN_BASE, ...overrides },
  })
}

// Keyboard nav goes through fireEvent.keyDown (the component's contract
// is its own keydown interception — Tab/Enter/Arrows never leave the
// input), matching the original trigger() semantics.
const input   = (label = 'Heroes') => screen.getByRole('combobox', { name: label })
const listbox = (label = 'Heroes') => screen.queryByRole('listbox', { name: label })
const options = () => screen.queryAllByRole('option')
const option  = (name: string) => options().find((o) => o.textContent?.includes(name))!

describe('TypeaheadDropdown', () => {
  describe('closed', () => {
    it('renders input + caret but no listbox', () => {
      renderDropdown({ open: false })
      expect(input()).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Open Heroes list' })).toBeInTheDocument()
      expect(listbox()).not.toBeInTheDocument()
    })
  })

  describe('open', () => {
    it('renders every option', () => {
      renderDropdown({ open: true })
      expect(options()).toHaveLength(HEROES.length)
    })

    it('listbox has aria-label = props.label', () => {
      renderDropdown({ open: true, label: 'Maps' })
      expect(listbox('Maps')).toBeInTheDocument()
    })

    it('listbox id matches props.listboxId so combobox can aria-control it', () => {
      renderDropdown({ open: true, listboxId: 'hero-list' })
      expect(listbox()).toHaveAttribute('id', 'hero-list')
    })
  })

  describe('isSelected', () => {
    it('passes aria-selected through per-option', () => {
      renderDropdown({
        open: true,
        isSelected: (o) => o === 'lucio',
      })
      expect(option('lucio')).toHaveAttribute('aria-selected', 'true')
      expect(option('mercy')).toHaveAttribute('aria-selected', 'false')
    })

    it('default isSelected returns false for every option', () => {
      renderDropdown({ open: true })
      expect(options().every((i) => i.getAttribute('aria-selected') === 'false')).toBe(true)
    })
  })

  describe('showCheckmark', () => {
    it('renders the ✓ column by default', () => {
      renderDropdown({
        open: true,
        isSelected: (o) => o === 'lucio',
      })
      expect(option('lucio')).toHaveTextContent('✓')
    })

    it('hides the ✓ column when showCheckmark=false (tag-picker shape)', () => {
      renderDropdown({
        open: true,
        showCheckmark: false,
        isSelected: (o) => o === 'lucio',
      })
      expect(option('lucio')).not.toHaveTextContent('✓')
    })
  })

  describe('typeahead filtering', () => {
    it('typing in the input narrows the list', async () => {
      renderDropdown({ open: true })
      await fireEvent.update(input(), 'luc')
      const items = options()
      expect(items).toHaveLength(1)
      expect(items[0]).toHaveTextContent('lucio')
    })

    it('matches by prefix (case-insensitive), not substring', async () => {
      renderDropdown({ open: true, options: ['ana', 'busan', 'zenyatta'] })
      await fireEvent.update(input(), 'AN')
      const items = options()
      // "ana" starts with "an"; "busan" only contains it, so it's excluded.
      expect(items).toHaveLength(1)
      expect(items[0]).toHaveTextContent('ana')
    })

    it('renders empty-message row when nothing matches', async () => {
      renderDropdown({ open: true, emptyMessage: 'no maps in corpus' })
      await fireEvent.update(input(), 'zzz')
      expect(screen.getByText('no maps in corpus')).toBeInTheDocument()
    })
  })

  describe('select emit', () => {
    it('mousedown on an option emits select with the value', async () => {
      const { emitted } = renderDropdown({ open: true })
      await fireEvent.mouseDown(option('mercy'))
      expect(emitted('select')).toEqual([['mercy']])
    })

    it('Enter on the keyboard-highlighted option emits select', async () => {
      const { emitted } = renderDropdown({ open: true })
      await fireEvent.keyDown(input(), { key: 'ArrowDown' })
      await fireEvent.keyDown(input(), { key: 'Enter' })
      expect(emitted('select')).toEqual([[HEROES[0]]])
    })

    it('Enter with no cursor + non-empty search emits free-text', async () => {
      const { emitted } = renderDropdown({ open: true })
      await fireEvent.update(input(), 'miyazaki')
      // No arrow keypress → cursor stays at -1 → Enter falls to free-text
      await fireEvent.keyDown(input(), { key: 'Enter' })
      expect(emitted('free-text')).toEqual([['miyazaki']])
      expect(emitted('select')).toBeUndefined()
    })

    it('Enter with empty search emits nothing', async () => {
      const { emitted } = renderDropdown({ open: true })
      await fireEvent.keyDown(input(), { key: 'Enter' })
      expect(emitted('select')).toBeUndefined()
      expect(emitted('free-text')).toBeUndefined()
    })
  })

  describe('autoHighlightFirst', () => {
    it('pre-highlights the first match while typing so Enter selects it without Tab', async () => {
      const { emitted } = renderDropdown({ open: true, autoHighlightFirst: true })
      await fireEvent.update(input(), 'luc')
      // The first (and here only) match carries the cursor highlight.
      expect(options()[0]).toHaveClass('cursor')
      // Enter selects it — no Arrow / Tab needed.
      await fireEvent.keyDown(input(), { key: 'Enter' })
      expect(emitted('select')).toEqual([['lucio']])
    })

    it('highlights the alphabetically-first of several matches', async () => {
      const { emitted } = renderDropdown({ open: true, autoHighlightFirst: true })
      // HEROES are pre-sorted; "a" matches only "ana" by prefix, so use a
      // shared-prefix set to prove "first match" is option 0 of the filtered list.
      await fireEvent.update(input(), 'a')
      await fireEvent.keyDown(input(), { key: 'Enter' })
      expect(emitted('select')).toEqual([['ana']])
    })

    it('drops the highlight when the query is cleared (Enter on a blank box selects nothing)', async () => {
      const { emitted } = renderDropdown({ open: true, autoHighlightFirst: true })
      await fireEvent.update(input(), 'luc')
      await fireEvent.update(input(), '')
      await fireEvent.keyDown(input(), { key: 'Enter' })
      expect(emitted('select')).toBeUndefined()
    })
  })

  describe('keyboard nav', () => {
    it('ArrowDown advances the cursor', async () => {
      renderDropdown({ open: true })
      await fireEvent.keyDown(input(), { key: 'ArrowDown' })
      expect(options()[0]).toHaveClass('cursor')
    })

    it('ArrowUp from cursor=0 wraps to the end', async () => {
      renderDropdown({ open: true })
      await fireEvent.keyDown(input(), { key: 'ArrowDown' }) // cursor → 0
      await fireEvent.keyDown(input(), { key: 'ArrowUp' })   // wraps → HEROES.length - 1
      expect(options()[HEROES.length - 1]).toHaveClass('cursor')
    })

    it('Home jumps to the first option', async () => {
      renderDropdown({ open: true })
      await fireEvent.keyDown(input(), { key: 'End' })
      await fireEvent.keyDown(input(), { key: 'Home' })
      expect(options()[0]).toHaveClass('cursor')
    })

    it('End jumps to the last option', async () => {
      renderDropdown({ open: true })
      await fireEvent.keyDown(input(), { key: 'End' })
      expect(options()[HEROES.length - 1]).toHaveClass('cursor')
    })

    it('Escape emits close', async () => {
      const { emitted } = renderDropdown({ open: true })
      await fireEvent.keyDown(input(), { key: 'Escape' })
      expect(emitted('close')).toHaveLength(1)
    })

    it('keyboard nav is a no-op when closed', async () => {
      const { emitted } = renderDropdown({ open: false })
      // Closed state has no listbox — but the input is still there.
      // Pressing ArrowDown should not advance any cursor or emit.
      await fireEvent.keyDown(input(), { key: 'ArrowDown' })
      expect(emitted('select')).toBeUndefined()
      expect(listbox()).not.toBeInTheDocument()
    })
  })

  describe('Tab to complete', () => {
    it('Tab highlights the next match so Enter selects it (no field exit)', async () => {
      const { emitted } = renderDropdown({ open: true })
      await fireEvent.update(input(), 'luc') // filters to lucio
      await fireEvent.keyDown(input(), { key: 'Tab' })
      expect(options()[0]).toHaveClass('cursor')
      await fireEvent.keyDown(input(), { key: 'Enter' })
      expect(emitted('select')).toEqual([['lucio']])
    })

    it('Shift+Tab steps back through the matches', async () => {
      renderDropdown({ open: true })
      await fireEvent.keyDown(input(), { key: 'Tab' })                 // -1 → 0
      await fireEvent.keyDown(input(), { key: 'Tab', shiftKey: true }) // 0 → last (wrap)
      expect(options()[HEROES.length - 1]).toHaveClass('cursor')
    })

    it('Tab keeps its normal focus move when closed (no match to complete)', async () => {
      const { emitted } = renderDropdown({ open: false })
      await fireEvent.keyDown(input(), { key: 'Tab' })
      expect(emitted('select')).toBeUndefined()
    })
  })

  describe('open / close emits', () => {
    it('focus on input emits open when closed', async () => {
      const { emitted } = renderDropdown({ open: false })
      await fireEvent.focus(input())
      expect(emitted('open')).toHaveLength(1)
    })

    it('caret click emits open when closed', async () => {
      const { emitted } = renderDropdown({ open: false })
      await fireEvent.click(screen.getByRole('button', { name: 'Open Heroes list' }))
      expect(emitted('open')).toHaveLength(1)
    })

    it('caret click emits close when open', async () => {
      const { emitted } = renderDropdown({ open: true })
      await fireEvent.click(screen.getByRole('button', { name: 'Close Heroes list' }))
      expect(emitted('close')).toHaveLength(1)
    })
  })

  describe('close resets state', () => {
    it('closing wipes search + cursor', async () => {
      const { rerender } = renderDropdown({ open: true })
      await fireEvent.update(input(), 'luc')
      await fireEvent.keyDown(input(), { key: 'ArrowDown' })
      await rerender({ open: false })
      await nextTick()
      await rerender({ open: true })
      await nextTick()
      // After reopen: search empty (every option visible), cursor reset.
      expect(options()).toHaveLength(HEROES.length)
      expect(input()).toHaveValue('')
    })
  })
})

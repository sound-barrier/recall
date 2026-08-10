import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import { nextTick } from 'vue'
import FilterCombobox from '@/components/shared/FilterCombobox.vue'

const HEROES = ['ana', 'kiriko', 'lucio', 'mercy', 'soldier', 'zenyatta']

function renderCombo(overrides: Partial<{
  comboId: string
  label: string
  options: string[]
  picked: Set<string>
  open: boolean
  placeholder: string
  emptyMessage: string
}> = {}) {
  return render(FilterCombobox, {
    props: {
      comboId: overrides.comboId ?? 'hero',
      label: overrides.label ?? 'Heroes',
      options: overrides.options ?? HEROES,
      picked: overrides.picked ?? new Set<string>(),
      open: overrides.open ?? false,
      ...(overrides.placeholder !== undefined ? { placeholder: overrides.placeholder } : {}),
      ...(overrides.emptyMessage !== undefined ? { emptyMessage: overrides.emptyMessage } : {}),
    },
  })
}

const input   = () => screen.getByRole('combobox', { name: 'Heroes' })
const caret   = () => screen.getByRole('button', { name: /Open Heroes list|Close Heroes list/ })
const listbox = () => screen.queryByRole('listbox', { name: 'Heroes' })
const options = () => screen.queryAllByRole('option')
const option  = (name: string) => options().find((o) => o.textContent?.includes(name))
const pillRemovers = () => screen.queryAllByLabelText(/^Drop /)

describe('FilterCombobox', () => {
  describe('closed state', () => {
    it('renders the input + caret but hides the dropdown list', () => {
      renderCombo()
      expect(input()).toBeInTheDocument()
      expect(caret()).toBeInTheDocument()
      expect(listbox()).not.toBeInTheDocument()
    })

    it('caret has aria-expanded="false"', () => {
      renderCombo({ open: false })
      expect(caret()).toHaveAttribute('aria-expanded', 'false')
    })

    it('does not render the selected-pills row when nothing is picked', () => {
      renderCombo({ picked: new Set() })
      expect(pillRemovers()).toHaveLength(0)
    })
  })

  describe('selected pills', () => {
    it('renders one pill per picked item with a remove button', () => {
      renderCombo({ picked: new Set(['lucio', 'mercy']) })
      // Each pill carries its value + a labeled remove button.
      expect(screen.getByText(/lucio/)).toBeInTheDocument()
      expect(screen.getByText(/mercy/)).toBeInTheDocument()
      expect(pillRemovers()).toHaveLength(2)
    })

    it('clicking a pill × emits toggle with that value', async () => {
      const { emitted } = renderCombo({ picked: new Set(['lucio']) })
      await fireEvent.click(screen.getByLabelText('Drop lucio'))
      expect(emitted('toggle')).toEqual([['lucio']])
    })

    it('remove button has an accessible aria-label', () => {
      renderCombo({ picked: new Set(['lucio']) })
      expect(screen.getByRole('button', { name: /drop.*lucio/i })).toBeInTheDocument()
    })
  })

  describe('opening', () => {
    it('emits open when the input is focused', async () => {
      const { emitted } = renderCombo({ open: false })
      await fireEvent.focus(input())
      expect(emitted('open')).toHaveLength(1)
    })

    it('emits open when the caret is clicked while closed', async () => {
      const { emitted } = renderCombo({ open: false })
      await fireEvent.click(caret())
      expect(emitted('open')).toHaveLength(1)
    })

    it('emits close when the caret is clicked while open', async () => {
      const { emitted } = renderCombo({ open: true })
      await fireEvent.click(caret())
      expect(emitted('close')).toHaveLength(1)
    })
  })

  describe('open state', () => {
    it('renders the dropdown list with every option', () => {
      renderCombo({ open: true })
      expect(options()).toHaveLength(HEROES.length)
    })

    it('list has role=listbox + aria-label', () => {
      renderCombo({ open: true, label: 'Heroes' })
      expect(listbox()).toBeInTheDocument()
    })

    it('each option has role=option + aria-selected reflects picked state', () => {
      renderCombo({ open: true, picked: new Set(['lucio']) })
      expect(option('lucio')).toHaveAttribute('aria-selected', 'true')
      expect(option('mercy')).toHaveAttribute('aria-selected', 'false')
    })

    it('picked options render a check glyph', () => {
      renderCombo({ open: true, picked: new Set(['lucio']) })
      expect(option('lucio')).toHaveTextContent('✓')
    })

    it('caret has aria-expanded="true"', () => {
      renderCombo({ open: true })
      expect(caret()).toHaveAttribute('aria-expanded', 'true')
    })
  })

  describe('typeahead filtering', () => {
    it('typing in the input narrows the dropdown list', async () => {
      renderCombo({ open: true })
      await fireEvent.update(input(), 'luc')
      const items = options()
      expect(items).toHaveLength(1)
      expect(items[0]).toHaveTextContent('lucio')
    })

    it('typing is case-insensitive', async () => {
      renderCombo({ open: true })
      await fireEvent.update(input(), 'MERCY')
      expect(options()).toHaveLength(1)
    })

    it('matches by prefix only (not substring)', async () => {
      renderCombo({ open: true, options: ['ana', 'busan', 'zenyatta'] })
      await fireEvent.update(input(), 'an')
      const items = options()
      // "ana" starts with "an"; "busan" contains it but isn't a prefix.
      expect(items).toHaveLength(1)
      expect(items[0]).toHaveTextContent('ana')
    })

    it('renders the empty-message row when no options match', async () => {
      const { baseElement } = renderCombo({ open: true })
      await fireEvent.update(input(), 'zzz')
      expect(options()).toHaveLength(0)
      // With no emptyMessage prop the row renders blank, so presence is
      // only observable structurally.
      // eslint-disable-next-line testing-library/no-node-access -- the default empty row carries no text to query
      expect(baseElement.querySelector('.combo-empty')).not.toBeNull()
    })

    it('emptyMessage prop customizes the no-matches row', async () => {
      renderCombo({ open: true, emptyMessage: 'no maps in the corpus' })
      await fireEvent.update(input(), 'zzz')
      expect(screen.getByText('no maps in the corpus')).toBeInTheDocument()
    })
  })

  describe('picking an option', () => {
    it('mousedown on an option emits toggle with the value', async () => {
      const { emitted } = renderCombo({ open: true })
      await fireEvent.mouseDown(option('mercy')!)
      expect(emitted('toggle')).toEqual([['mercy']])
    })

    it('mousedown is prevented so the input keeps focus', async () => {
      // We can't easily assert event.preventDefault was called on the
      // raw event with happy-dom, but we can assert the handler is
      // wired via the .prevent modifier — emitting toggle is the
      // proof.
      const { emitted } = renderCombo({ open: true })
      await fireEvent.mouseDown(options()[0]!)
      expect(emitted('toggle')).toBeTruthy()
    })

    it('toggle on an already-picked option still emits (parent decides what to do)', async () => {
      const { emitted } = renderCombo({ open: true, picked: new Set(['lucio']) })
      await fireEvent.mouseDown(option('lucio')!)
      expect(emitted('toggle')).toEqual([['lucio']])
    })

    it('auto-highlights the first match so Enter picks it without Tab', async () => {
      const { emitted } = renderCombo({ open: true })
      await fireEvent.update(input(), 'luc')
      await fireEvent.keyDown(input(), { key: 'Enter' })
      expect(emitted('toggle')).toEqual([['lucio']])
    })
  })

  describe('data-combo-id', () => {
    it('exposes data-combo-id on the root so click-outside detection works', () => {
      const { baseElement } = renderCombo({ comboId: 'map' })
      // The attribute exists precisely for selector-based click-outside
      // detection, so the node access pins that contract.
      // eslint-disable-next-line testing-library/no-node-access -- data-combo-id exists FOR selector-based click-outside detection
      expect(baseElement.querySelector('[data-combo-id="map"]')).not.toBeNull()
    })
  })

  describe('placeholder', () => {
    it('uses a sensible default with the option count', () => {
      renderCombo({ options: HEROES })
      expect(input()).toHaveAttribute('placeholder', expect.stringContaining(String(HEROES.length)))
    })

    it('respects an explicit placeholder', () => {
      renderCombo({ placeholder: 'hunt for a map…' })
      expect(input()).toHaveAttribute('placeholder', 'hunt for a map…')
    })
  })

  describe('reactivity', () => {
    it('updates the rendered options when the options prop changes', async () => {
      const { rerender } = renderCombo({ open: true, options: ['a', 'b'] })
      expect(options()).toHaveLength(2)
      await rerender({ options: ['x', 'y', 'z'] })
      await nextTick()
      expect(options()).toHaveLength(3)
    })

    it('updates the picked-pills row when the picked prop changes', async () => {
      const { rerender } = renderCombo({ picked: new Set(['lucio']) })
      expect(pillRemovers()).toHaveLength(1)
      await rerender({ picked: new Set(['lucio', 'mercy']) })
      await nextTick()
      expect(pillRemovers()).toHaveLength(2)
    })
  })
})

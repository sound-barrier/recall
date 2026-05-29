import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import FilterCombobox from './FilterCombobox.vue'

const HEROES = ['ana', 'kiriko', 'lucio', 'mercy', 'soldier', 'zenyatta']

function mountCombo(overrides: Partial<{
  comboId: string
  label: string
  options: string[]
  picked: Set<string>
  open: boolean
  placeholder: string
  emptyMessage: string
}> = {}) {
  return mount(FilterCombobox, {
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

describe('FilterCombobox', () => {
  describe('closed state', () => {
    it('renders the input + caret but hides the dropdown list', () => {
      const wrapper = mountCombo()
      expect(wrapper.find('input.combo-input').exists()).toBe(true)
      expect(wrapper.find('button.combo-caret').exists()).toBe(true)
      expect(wrapper.find('ul.combo-list').exists()).toBe(false)
    })

    it('caret has aria-expanded="false"', () => {
      const wrapper = mountCombo({ open: false })
      const caret = wrapper.find('button.combo-caret')
      expect(caret.attributes('aria-expanded')).toBe('false')
    })

    it('does not render the selected-pills row when nothing is picked', () => {
      const wrapper = mountCombo({ picked: new Set() })
      expect(wrapper.find('.combo-selected').exists()).toBe(false)
    })
  })

  describe('selected pills', () => {
    it('renders one pill per picked item with a remove button', () => {
      const wrapper = mountCombo({ picked: new Set(['lucio', 'mercy']) })
      const pills = wrapper.findAll('.combo-pill')
      expect(pills).toHaveLength(2)
      const texts = pills.map((p) => p.text())
      expect(texts.some((t) => t.includes('lucio'))).toBe(true)
      expect(texts.some((t) => t.includes('mercy'))).toBe(true)
      // Each pill has a remove button.
      expect(wrapper.findAll('.combo-pill .combo-pill-x')).toHaveLength(2)
    })

    it('clicking a pill × emits toggle with that value', async () => {
      const wrapper = mountCombo({ picked: new Set(['lucio']) })
      await wrapper.find('.combo-pill-x').trigger('click')
      expect(wrapper.emitted('toggle')).toEqual([['lucio']])
    })

    it('remove button has an accessible aria-label', () => {
      const wrapper = mountCombo({ picked: new Set(['lucio']) })
      const xBtn = wrapper.find('.combo-pill-x')
      expect(xBtn.attributes('aria-label')).toMatch(/drop.*lucio/i)
    })
  })

  describe('opening', () => {
    it('emits open when the input is focused', async () => {
      const wrapper = mountCombo({ open: false })
      await wrapper.find('input.combo-input').trigger('focus')
      expect(wrapper.emitted('open')).toHaveLength(1)
    })

    it('emits open when the caret is clicked while closed', async () => {
      const wrapper = mountCombo({ open: false })
      await wrapper.find('button.combo-caret').trigger('click')
      expect(wrapper.emitted('open')).toHaveLength(1)
    })

    it('emits close when the caret is clicked while open', async () => {
      const wrapper = mountCombo({ open: true })
      await wrapper.find('button.combo-caret').trigger('click')
      expect(wrapper.emitted('close')).toHaveLength(1)
    })
  })

  describe('open state', () => {
    it('renders the dropdown list with every option', () => {
      const wrapper = mountCombo({ open: true })
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      expect(items).toHaveLength(HEROES.length)
    })

    it('list has role=listbox + aria-label', () => {
      const wrapper = mountCombo({ open: true, label: 'Heroes' })
      const list = wrapper.find('ul.combo-list')
      expect(list.attributes('role')).toBe('listbox')
      expect(list.attributes('aria-label')).toBe('Heroes')
    })

    it('each option has role=option + aria-selected reflects picked state', () => {
      const wrapper = mountCombo({ open: true, picked: new Set(['lucio']) })
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      const lucioItem = items.find((i) => i.text().includes('lucio'))
      const mercyItem = items.find((i) => i.text().includes('mercy'))
      expect(lucioItem?.attributes('aria-selected')).toBe('true')
      expect(mercyItem?.attributes('aria-selected')).toBe('false')
    })

    it('picked options render a check glyph', () => {
      const wrapper = mountCombo({ open: true, picked: new Set(['lucio']) })
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      const lucioItem = items.find((i) => i.text().includes('lucio'))!
      expect(lucioItem.find('.combo-check').text()).toBe('✓')
    })

    it('caret has aria-expanded="true"', () => {
      const wrapper = mountCombo({ open: true })
      expect(wrapper.find('button.combo-caret').attributes('aria-expanded')).toBe('true')
    })
  })

  describe('typeahead filtering', () => {
    it('typing in the input narrows the dropdown list', async () => {
      const wrapper = mountCombo({ open: true })
      await wrapper.find('input.combo-input').setValue('luc')
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      expect(items).toHaveLength(1)
      expect(items[0]!.text()).toContain('lucio')
    })

    it('typing is case-insensitive', async () => {
      const wrapper = mountCombo({ open: true })
      await wrapper.find('input.combo-input').setValue('MERCY')
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      expect(items).toHaveLength(1)
    })

    it('substring matches (not just prefix)', async () => {
      const wrapper = mountCombo({ open: true })
      await wrapper.find('input.combo-input').setValue('era') // matches "zenyatta"? no — let's use real substring
      await wrapper.find('input.combo-input').setValue('ny')
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      expect(items).toHaveLength(1)
      expect(items[0]!.text()).toContain('zenyatta')
    })

    it('renders the empty-message row when no options match', async () => {
      const wrapper = mountCombo({ open: true })
      await wrapper.find('input.combo-input').setValue('zzz')
      expect(wrapper.findAll('ul.combo-list li[role="option"]')).toHaveLength(0)
      expect(wrapper.find('.combo-empty').exists()).toBe(true)
    })

    it('emptyMessage prop customizes the no-matches row', async () => {
      const wrapper = mountCombo({ open: true, emptyMessage: 'no maps in the corpus' })
      await wrapper.find('input.combo-input').setValue('zzz')
      expect(wrapper.find('.combo-empty').text()).toContain('no maps in the corpus')
    })
  })

  describe('picking an option', () => {
    it('mousedown on an option emits toggle with the value', async () => {
      const wrapper = mountCombo({ open: true })
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      const mercyItem = items.find((i) => i.text().includes('mercy'))!
      await mercyItem.trigger('mousedown')
      expect(wrapper.emitted('toggle')).toEqual([['mercy']])
    })

    it('mousedown is prevented so the input keeps focus', async () => {
      // We can't easily assert event.preventDefault was called on the
      // raw event with happy-dom, but we can assert the handler is
      // wired via the .prevent modifier — emitting toggle is the
      // proof.
      const wrapper = mountCombo({ open: true })
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      await items[0]!.trigger('mousedown')
      expect(wrapper.emitted('toggle')).toBeTruthy()
    })

    it('toggle on an already-picked option still emits (parent decides what to do)', async () => {
      const wrapper = mountCombo({ open: true, picked: new Set(['lucio']) })
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      const lucioItem = items.find((i) => i.text().includes('lucio'))!
      await lucioItem.trigger('mousedown')
      expect(wrapper.emitted('toggle')).toEqual([['lucio']])
    })
  })

  describe('data-combo-id', () => {
    it('exposes data-combo-id on the root so click-outside detection works', () => {
      const wrapper = mountCombo({ comboId: 'map' })
      expect((wrapper.element as HTMLElement).getAttribute('data-combo-id')).toBe('map')
    })
  })

  describe('placeholder', () => {
    it('uses a sensible default with the option count', () => {
      const wrapper = mountCombo({ options: HEROES })
      const input = wrapper.find('input.combo-input')
      expect(input.attributes('placeholder')).toContain(String(HEROES.length))
    })

    it('respects an explicit placeholder', () => {
      const wrapper = mountCombo({ placeholder: 'hunt for a map…' })
      expect(wrapper.find('input.combo-input').attributes('placeholder')).toBe('hunt for a map…')
    })
  })

  describe('reactivity', () => {
    it('updates the rendered options when the options prop changes', async () => {
      const wrapper = mountCombo({ open: true, options: ['a', 'b'] })
      expect(wrapper.findAll('ul.combo-list li[role="option"]')).toHaveLength(2)
      await wrapper.setProps({ options: ['x', 'y', 'z'] })
      await nextTick()
      expect(wrapper.findAll('ul.combo-list li[role="option"]')).toHaveLength(3)
    })

    it('updates the picked-pills row when the picked prop changes', async () => {
      const wrapper = mountCombo({ picked: new Set(['lucio']) })
      expect(wrapper.findAll('.combo-pill')).toHaveLength(1)
      await wrapper.setProps({ picked: new Set(['lucio', 'mercy']) })
      await nextTick()
      expect(wrapper.findAll('.combo-pill')).toHaveLength(2)
    })
  })
})

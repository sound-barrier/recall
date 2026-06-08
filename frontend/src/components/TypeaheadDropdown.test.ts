import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import TypeaheadDropdown from './TypeaheadDropdown.vue'

const HEROES = ['ana', 'kiriko', 'lucio', 'mercy', 'soldier', 'zenyatta']

function mountDropdown(overrides: Partial<{
  listboxId: string
  label: string
  options: string[]
  open: boolean
  placeholder: string
  emptyMessage: string
  isSelected: (opt: string) => boolean
  showCheckmark: boolean
}> = {}) {
  return mount(TypeaheadDropdown, {
    attachTo: document.body,
    props: {
      listboxId: overrides.listboxId ?? 'td-test',
      label: overrides.label ?? 'Heroes',
      options: overrides.options ?? HEROES,
      open: overrides.open ?? false,
      ...(overrides.placeholder !== undefined ? { placeholder: overrides.placeholder } : {}),
      ...(overrides.emptyMessage !== undefined ? { emptyMessage: overrides.emptyMessage } : {}),
      ...(overrides.isSelected !== undefined ? { isSelected: overrides.isSelected } : {}),
      ...(overrides.showCheckmark !== undefined ? { showCheckmark: overrides.showCheckmark } : {}),
    },
  })
}

describe('TypeaheadDropdown', () => {
  describe('closed', () => {
    it('renders input + caret but no listbox', () => {
      const wrapper = mountDropdown({ open: false })
      expect(wrapper.find('input.combo-input').exists()).toBe(true)
      expect(wrapper.find('button.combo-caret').exists()).toBe(true)
      expect(wrapper.find('ul.combo-list').exists()).toBe(false)
    })
  })

  describe('open', () => {
    it('renders every option', () => {
      const wrapper = mountDropdown({ open: true })
      expect(wrapper.findAll('ul.combo-list li[role="option"]')).toHaveLength(HEROES.length)
    })

    it('listbox has aria-label = props.label', () => {
      const wrapper = mountDropdown({ open: true, label: 'Maps' })
      expect(wrapper.find('ul.combo-list').attributes('aria-label')).toBe('Maps')
    })

    it('listbox id matches props.listboxId so combobox can aria-control it', () => {
      const wrapper = mountDropdown({ open: true, listboxId: 'hero-list' })
      expect(wrapper.find('ul.combo-list').attributes('id')).toBe('hero-list')
    })
  })

  describe('isSelected', () => {
    it('passes aria-selected through per-option', () => {
      const wrapper = mountDropdown({
        open: true,
        isSelected: (o) => o === 'lucio',
      })
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      const lucio = items.find((i) => i.text().includes('lucio'))!
      const mercy = items.find((i) => i.text().includes('mercy'))!
      expect(lucio.attributes('aria-selected')).toBe('true')
      expect(mercy.attributes('aria-selected')).toBe('false')
    })

    it('default isSelected returns false for every option', () => {
      const wrapper = mountDropdown({ open: true })
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      expect(items.every((i) => i.attributes('aria-selected') === 'false')).toBe(true)
    })
  })

  describe('showCheckmark', () => {
    it('renders the ✓ column by default', () => {
      const wrapper = mountDropdown({
        open: true,
        isSelected: (o) => o === 'lucio',
      })
      const lucio = wrapper.findAll('ul.combo-list li[role="option"]')
        .find((i) => i.text().includes('lucio'))!
      expect(lucio.find('.combo-check').exists()).toBe(true)
      expect(lucio.find('.combo-check').text()).toBe('✓')
    })

    it('hides the ✓ column when showCheckmark=false (tag-picker shape)', () => {
      const wrapper = mountDropdown({
        open: true,
        showCheckmark: false,
        isSelected: (o) => o === 'lucio',
      })
      expect(wrapper.find('.combo-check').exists()).toBe(false)
    })
  })

  describe('typeahead filtering', () => {
    it('typing in the input narrows the list', async () => {
      const wrapper = mountDropdown({ open: true })
      await wrapper.find('input.combo-input').setValue('luc')
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      expect(items).toHaveLength(1)
      expect(items[0]!.text()).toContain('lucio')
    })

    it('substring + case-insensitive', async () => {
      const wrapper = mountDropdown({ open: true })
      await wrapper.find('input.combo-input').setValue('NY')
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      expect(items).toHaveLength(1)
      expect(items[0]!.text()).toContain('zenyatta')
    })

    it('renders empty-message row when nothing matches', async () => {
      const wrapper = mountDropdown({ open: true, emptyMessage: 'no maps in corpus' })
      await wrapper.find('input.combo-input').setValue('zzz')
      expect(wrapper.find('.combo-empty').text()).toContain('no maps in corpus')
    })
  })

  describe('select emit', () => {
    it('mousedown on an option emits select with the value', async () => {
      const wrapper = mountDropdown({ open: true })
      const mercy = wrapper.findAll('ul.combo-list li[role="option"]')
        .find((i) => i.text().includes('mercy'))!
      await mercy.trigger('mousedown')
      expect(wrapper.emitted('select')).toEqual([['mercy']])
    })

    it('Enter on the keyboard-highlighted option emits select', async () => {
      const wrapper = mountDropdown({ open: true })
      const input = wrapper.find('input.combo-input')
      await input.trigger('keydown', { key: 'ArrowDown' })
      await input.trigger('keydown', { key: 'Enter' })
      expect(wrapper.emitted('select')).toEqual([[HEROES[0]]])
    })

    it('Enter with no cursor + non-empty search emits free-text', async () => {
      const wrapper = mountDropdown({ open: true })
      const input = wrapper.find('input.combo-input')
      await input.setValue('miyazaki')
      // No arrow keypress → cursor stays at -1 → Enter falls to free-text
      await input.trigger('keydown', { key: 'Enter' })
      expect(wrapper.emitted('free-text')).toEqual([['miyazaki']])
      expect(wrapper.emitted('select')).toBeUndefined()
    })

    it('Enter with empty search emits nothing', async () => {
      const wrapper = mountDropdown({ open: true })
      await wrapper.find('input.combo-input').trigger('keydown', { key: 'Enter' })
      expect(wrapper.emitted('select')).toBeUndefined()
      expect(wrapper.emitted('free-text')).toBeUndefined()
    })
  })

  describe('keyboard nav', () => {
    it('ArrowDown advances the cursor', async () => {
      const wrapper = mountDropdown({ open: true })
      const input = wrapper.find('input.combo-input')
      await input.trigger('keydown', { key: 'ArrowDown' })
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      expect(items[0]!.classes()).toContain('cursor')
    })

    it('ArrowUp from cursor=0 wraps to the end', async () => {
      const wrapper = mountDropdown({ open: true })
      const input = wrapper.find('input.combo-input')
      await input.trigger('keydown', { key: 'ArrowDown' }) // cursor → 0
      await input.trigger('keydown', { key: 'ArrowUp' })   // wraps → HEROES.length - 1
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      expect(items[HEROES.length - 1]!.classes()).toContain('cursor')
    })

    it('Home jumps to the first option', async () => {
      const wrapper = mountDropdown({ open: true })
      const input = wrapper.find('input.combo-input')
      await input.trigger('keydown', { key: 'End' })
      await input.trigger('keydown', { key: 'Home' })
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      expect(items[0]!.classes()).toContain('cursor')
    })

    it('End jumps to the last option', async () => {
      const wrapper = mountDropdown({ open: true })
      await wrapper.find('input.combo-input').trigger('keydown', { key: 'End' })
      const items = wrapper.findAll('ul.combo-list li[role="option"]')
      expect(items[HEROES.length - 1]!.classes()).toContain('cursor')
    })

    it('Escape emits close', async () => {
      const wrapper = mountDropdown({ open: true })
      await wrapper.find('input.combo-input').trigger('keydown', { key: 'Escape' })
      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('keyboard nav is a no-op when closed', async () => {
      const wrapper = mountDropdown({ open: false })
      const input = wrapper.find('input.combo-input')
      // Closed state has no listbox — but the input is still there.
      // Pressing ArrowDown should not advance any cursor or emit.
      await input.trigger('keydown', { key: 'ArrowDown' })
      expect(wrapper.emitted('select')).toBeUndefined()
      expect(wrapper.find('ul.combo-list').exists()).toBe(false)
    })
  })

  describe('open / close emits', () => {
    it('focus on input emits open when closed', async () => {
      const wrapper = mountDropdown({ open: false })
      await wrapper.find('input.combo-input').trigger('focus')
      expect(wrapper.emitted('open')).toHaveLength(1)
    })

    it('caret click emits open when closed', async () => {
      const wrapper = mountDropdown({ open: false })
      await wrapper.find('button.combo-caret').trigger('click')
      expect(wrapper.emitted('open')).toHaveLength(1)
    })

    it('caret click emits close when open', async () => {
      const wrapper = mountDropdown({ open: true })
      await wrapper.find('button.combo-caret').trigger('click')
      expect(wrapper.emitted('close')).toHaveLength(1)
    })
  })

  describe('close resets state', () => {
    it('closing wipes search + cursor', async () => {
      const wrapper = mountDropdown({ open: true })
      const input = wrapper.find('input.combo-input')
      await input.setValue('luc')
      await input.trigger('keydown', { key: 'ArrowDown' })
      await wrapper.setProps({ open: false })
      await nextTick()
      await wrapper.setProps({ open: true })
      await nextTick()
      // After reopen: search empty (every option visible), cursor reset.
      expect(wrapper.findAll('ul.combo-list li[role="option"]')).toHaveLength(HEROES.length)
      expect((wrapper.find('input.combo-input').element as HTMLInputElement).value).toBe('')
    })
  })
})

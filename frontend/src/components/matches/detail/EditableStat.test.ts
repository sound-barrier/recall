import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import EditableStat from './EditableStat.vue'

type Wrapper = ReturnType<typeof mount>

async function edit(wrapper: Wrapper, value: string) {
  await wrapper.find('.stat-edit-trigger').trigger('click')
  const input = wrapper.find('.stat-input')
  await input.setValue(value)
  await input.trigger('keydown', { key: 'Enter' })
}

describe('EditableStat numeric validation', () => {
  it('rejects a negative number: shows an inline error, keeps editing, no commit', async () => {
    const wrapper = mount(EditableStat, { props: { label: 'Damage', value: 100, kind: 'number' } })
    await edit(wrapper, '-5')
    expect(wrapper.emitted('commit')).toBeUndefined()
    expect(wrapper.find('.stat-error').exists()).toBe(true)
    expect(wrapper.find('.stat-input').exists()).toBe(true) // stays open to fix
  })

  it('rejects a value above max', async () => {
    const wrapper = mount(EditableStat, { props: { label: 'Damage', value: 100, kind: 'number', max: 1000 } })
    await edit(wrapper, '5000')
    expect(wrapper.emitted('commit')).toBeUndefined()
    expect(wrapper.find('.stat-error').exists()).toBe(true)
  })

  it('commits a valid in-range number and shows no error', async () => {
    const wrapper = mount(EditableStat, { props: { label: 'Damage', value: 100, kind: 'number' } })
    await edit(wrapper, '250')
    expect(wrapper.emitted('commit')?.[0]).toEqual([250])
    expect(wrapper.find('.stat-error').exists()).toBe(false)
  })

  it('does not range-check text fields', async () => {
    const wrapper = mount(EditableStat, { props: { label: 'Note', value: 'a', kind: 'text' } })
    await edit(wrapper, '-5')
    expect(wrapper.emitted('commit')?.[0]).toEqual(['-5'])
  })
})

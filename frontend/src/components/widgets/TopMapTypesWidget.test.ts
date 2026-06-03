import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TopMapTypesWidget from './TopMapTypesWidget.vue'

describe('TopMapTypesWidget', () => {
  it('renders no rows for an empty list', () => {
    const w = mount(TopMapTypesWidget, { props: { topMapTypes: [] } })
    expect(w.findAll('li')).toHaveLength(0)
  })

  it('renders each map type with count + share', () => {
    const w = mount(TopMapTypesWidget, {
      props: {
        topMapTypes: [
          { key: 'control', total: 8, share: 50, winrate: 75 },
          { key: 'hybrid',  total: 4, share: 25, winrate: 50 },
        ],
      },
    })
    const rows = w.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.find('.bd-name').text()).toBe('control')
    expect(rows[0]!.find('.bd-time').text()).toBe('8x')
    expect(rows[0]!.find('.bd-stats').text()).toBe('50%')
  })
})

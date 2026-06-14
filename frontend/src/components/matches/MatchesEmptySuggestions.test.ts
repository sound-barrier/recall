import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MatchesEmptySuggestions from '@/components/matches/MatchesEmptySuggestions.vue'

describe('MatchesEmptySuggestions', () => {
  it('renders nothing when suggestions is empty', () => {
    const wrapper = mount(MatchesEmptySuggestions, { props: { suggestions: [] } })
    expect(wrapper.find('.empty-suggestions').exists()).toBe(false)
  })

  it('renders one button per suggestion', () => {
    const cleared: string[] = []
    const wrapper = mount(MatchesEmptySuggestions, {
      props: {
        suggestions: [
          { clauseId: 'maps',   label: 'map filter',  wouldSurface: 12, clear: () => { cleared.push('maps') } },
          { clauseId: 'heroes', label: 'hero filter', wouldSurface:  8, clear: () => { cleared.push('heroes') } },
        ],
      },
    })
    const btns = wrapper.findAll('button.empty-suggestion-btn')
    expect(btns).toHaveLength(2)
    expect(btns[0]!.attributes('data-clause-id')).toBe('maps')
    expect(btns[0]!.text()).toContain('Remove map filter')
    expect(btns[0]!.text()).toContain('12 matches')
  })

  it('clicking a suggestion calls its clear handler', async () => {
    const cleared: string[] = []
    const wrapper = mount(MatchesEmptySuggestions, {
      props: {
        suggestions: [
          { clauseId: 'tags', label: 'tag filter', wouldSurface: 3, clear: () => { cleared.push('tags') } },
        ],
      },
    })
    await wrapper.find('button.empty-suggestion-btn').trigger('click')
    expect(cleared).toEqual(['tags'])
  })
})

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Recent5MatchesWidget from './Recent5MatchesWidget.vue'

describe('Recent5MatchesWidget', () => {
  it('renders the empty-state message when there are no results', () => {
    const w = mount(Recent5MatchesWidget, { props: { results: [] } })
    expect(w.find('.recent-empty').exists()).toBe(true)
    expect(w.findAll('.recent-pill')).toHaveLength(0)
  })

  it('renders a pill per result in newest-first order with the right class', () => {
    const w = mount(Recent5MatchesWidget, {
      props: { results: ['victory', 'defeat', 'defeat', 'victory', 'draw'] },
    })
    const pills = w.findAll('.recent-pill')
    expect(pills).toHaveLength(5)
    expect(pills[0]!.text()).toBe('W')
    expect(pills[0]!.classes()).toContain('recent-pill-victory')
    expect(pills[1]!.text()).toBe('L')
    expect(pills[1]!.classes()).toContain('recent-pill-defeat')
    expect(pills[4]!.text()).toBe('D')
    expect(pills[4]!.classes()).toContain('recent-pill-draw')
  })

  it('exposes the count via data-recent-count for selector-based assertions', () => {
    const w = mount(Recent5MatchesWidget, {
      props: { results: ['victory', 'victory', 'defeat'] },
    })
    expect(w.find('.recent-pills').attributes('data-recent-count')).toBe('3')
  })
})

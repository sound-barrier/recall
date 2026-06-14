import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MatchesSkeleton from '@/components/matches/MatchesSkeleton.vue'

describe('MatchesSkeleton', () => {
  it('renders the default six skeleton rows', () => {
    const w = mount(MatchesSkeleton)
    expect(w.findAll('.leaf-skeleton').length).toBe(6)
  })

  it('honors the rows prop', () => {
    const w = mount(MatchesSkeleton, { props: { rows: 3 } })
    expect(w.findAll('.leaf-skeleton').length).toBe(3)
  })

  it('announces busy state for assistive tech', () => {
    const w = mount(MatchesSkeleton)
    expect(w.find('[data-matches-loading="true"]').exists()).toBe(true)
    expect(w.find('[aria-busy="true"]').exists()).toBe(true)
    expect(w.find('section').attributes('aria-label')).toBe('Loading matches')
  })

  it('each skeleton row exposes the eight grid cells', () => {
    const w = mount(MatchesSkeleton, { props: { rows: 1 } })
    const row = w.find('.leaf-skeleton')
    // checkbox, strip, when, map, hero, stats, meta, result — 8 children.
    expect(row.element.children.length).toBe(8)
  })
})

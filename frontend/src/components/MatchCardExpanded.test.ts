import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import MatchCardExpanded from './MatchCardExpanded.vue'
import type { MatchRecord } from '../api'

// MatchCardExpanded owns annotation draft state, the leaver-chooser
// chips, heroes-played collapse, and the sources block. These tests
// pin the externally-observable contract: emits + render branches.

function makeRecord(over: Partial<MatchRecord['data']> = {}, top: Partial<MatchRecord> = {}): MatchRecord {
  return {
    match_key: 'match-2026-05-10T22-21-11',
    source_files: ['a.png'],
    data: {
      map: 'rialto', playlist: 'competitive', type: 'control',
      role: 'support', hero: 'lucio', result: 'victory',
      date: '2026-05-10', finished_at: '22:21',
      eliminations: 17, assists: 12, deaths: 8, damage: 8500,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:25' }],
      ...over,
    },
    parsed_at: '2026-05-10T22:30:00Z',
    ...top,
  }
}

function mountCard(over: { record?: MatchRecord; isSourcesOpen?: boolean } = {}) {
  return mount(MatchCardExpanded, {
    props: {
      record: over.record ?? makeRecord(),
      isSourcesOpen: over.isSourcesOpen ?? false,
      isPreviewOpen:   () => false,
      hasPreviewError: () => false,
      isActive: () => false,
    },
  })
}

describe('MatchCardExpanded — stats grid', () => {
  it('renders six stat cells in the match-stats grid', () => {
    const wrapper = mountCard()
    const stats = wrapper.findAll('.stat')
    // Eliminations, Assists, Deaths, Damage, Healing, Mitigation.
    expect(stats.length).toBeGreaterThanOrEqual(6)
  })

  it('shows the eliminations + assists numeric values', () => {
    const wrapper = mountCard()
    const text = wrapper.text()
    expect(text).toContain('17') // eliminations
    expect(text).toContain('12') // assists
    // Damage is formatted with thousands separator on render
    // (`8,500`), so assert the leading digit.
    expect(text).toMatch(/8[,.]?5/)
  })
})

describe('MatchCardExpanded — leaver chips', () => {
  // The three leaver chips emit `set-leaver-annotation` with either
  // the new leaver string or "" (toggle-off) depending on whether
  // the chip is already active. Find by .leaver-chip class — the
  // first chip is "I left" (self), second is "Ally" (team), third
  // is "Opponent" (enemy).
  it('emits leaver=self when the first chip ("I left") is clicked from a non-leaver record', async () => {
    const wrapper = mountCard()
    const chips = wrapper.findAll('.leaver-chip')
    expect(chips.length).toBeGreaterThanOrEqual(3)
    await chips[0]!.trigger('click')
    const e = wrapper.emitted('set-leaver-annotation')!
    expect(e[0]).toEqual([wrapper.props('record').match_key, 'self'])
  })

  it('emits leaver="" when the first chip is clicked on a record already marked self', async () => {
    const rec = makeRecord({}, { annotation: { leaver: 'self' } } as unknown as Partial<MatchRecord>)
    const wrapper = mountCard({ record: rec })
    const chips = wrapper.findAll('.leaver-chip')
    await chips[0]!.trigger('click')
    const e = wrapper.emitted('set-leaver-annotation')!
    expect(e[0]).toEqual([rec.match_key, ''])
  })

  it('marks the active chip with aria-pressed="true"', () => {
    const rec = makeRecord({}, { annotation: { leaver: 'team' } } as unknown as Partial<MatchRecord>)
    const wrapper = mountCard({ record: rec })
    const chips = wrapper.findAll('.leaver-chip')
    // First chip = self (false), second = team (true), third = enemy (false).
    expect(chips[1]!.attributes('aria-pressed')).toBe('true')
    expect(chips[0]!.attributes('aria-pressed')).toBe('false')
    expect(chips[2]!.attributes('aria-pressed')).toBe('false')
  })
})

describe('MatchCardExpanded — heroes played toggle', () => {
  it('renders the heroes-played list initially expanded', () => {
    const wrapper = mountCard()
    // heroesExpanded starts true; the list should be present.
    expect(wrapper.text()).toContain('lucio')
  })
})

describe('MatchCardExpanded — sources block', () => {
  it('renders the sources block only when isSourcesOpen is true', async () => {
    const closed = mountCard({ isSourcesOpen: false })
    // .sources is only mounted when isSourcesOpen=true.
    expect(closed.find('.sources').exists()).toBe(false)
    const open = mountCard({ isSourcesOpen: true })
    expect(open.find('.sources').exists()).toBe(true)
  })

  it('shows the source filename in the open sources block', () => {
    const wrapper = mountCard({ isSourcesOpen: true })
    expect(wrapper.text()).toContain('a.png')
  })
})

describe('MatchCardExpanded — since-this-match anchor toggle', () => {
  function mountAnchor(anchorKey?: string) {
    return mount(MatchCardExpanded, {
      props: {
        record: makeRecord(),
        isSourcesOpen: false,
        isPreviewOpen:   () => false,
        hasPreviewError: () => false,
        isActive: () => false,
        anchorKey,
      },
    })
  }

  it('renders the anchor button with the idle copy when this match is NOT the anchor', () => {
    const w = mountAnchor('some-other-match')
    const btn = w.find('[data-set-anchor]')
    expect(btn.exists()).toBe(true)
    // Action-first label ("Filter from this match") + plain-language
    // sublabel that names the consequence inline so a touch /
    // keyboard user doesn't depend on the tooltip.
    expect(btn.text()).toMatch(/Filter from this match/i)
    expect(btn.text()).toMatch(/marks this as your reference point/i)
    expect(btn.classes()).not.toContain('is-anchor')
  })

  it('renders the anchor button with the active copy + class when this match IS the anchor', () => {
    const w = mountAnchor('match-2026-05-10T22-21-11')
    const btn = w.find('[data-set-anchor]')
    expect(btn.classes()).toContain('is-anchor')
    expect(btn.text()).toMatch(/Filtering from this match/i)
    expect(btn.text()).toMatch(/Reference set/i)
    expect(btn.text()).toMatch(/click to clear/i)
    expect(btn.attributes('data-anchor-set')).toBe('true')
  })

  it('clicking when not the anchor emits set-anchor(matchKey)', async () => {
    const w = mountAnchor('')
    await w.find('[data-set-anchor]').trigger('click')
    const emitted = w.emitted('set-anchor')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual(['match-2026-05-10T22-21-11'])
  })

  it('clicking when this match IS the anchor emits set-anchor("") to clear', async () => {
    const w = mountAnchor('match-2026-05-10T22-21-11')
    await w.find('[data-set-anchor]').trigger('click')
    expect(w.emitted('set-anchor')![0]).toEqual([''])
  })
})

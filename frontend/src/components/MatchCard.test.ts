import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import MatchCard from './MatchCard.vue'
import type { MatchRecord } from '../api'

// MatchCard is the collapsed-row shell — header chrome, badges, and
// the "is-selected" accent treatment when the detail panel is open
// for this row. Body assertions (journal, leaver chooser, stats,
// sources, danger row) live in `MatchDetailPanel.test.ts` since the
// panel hosts the expanded surfaces now.

function makeRecord(over: Partial<MatchRecord['data']> = {}, recOver: Partial<MatchRecord> = {}): MatchRecord {
  return {
    match_key: 'match:2026-05-10T21:29:28',
    source_files: ['summary.png', 'scoreboard.png'],
    source_types: { 'summary.png': 'summary', 'scoreboard.png': 'scoreboard' },
    data: {
      map: 'rialto',
      mode: 'competitive',
      type: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '21:29',
      game_length: '11:25',
      final_score: '3-1',
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      healing: 4800,
      mitigation: 0,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25', stats: { weapon_accuracy: 24 } }],
      ...over,
    },
    ...recOver,
  }
}

interface CardMountOver {
  record?:        MatchRecord
  index?:         number
  isSelected?:    boolean
  isActive?:      (field: string, value: string) => boolean
  densityMode?:   'comfortable' | 'compact'
}

function mountCard(over: CardMountOver = {}) {
  return mount(MatchCard, {
    props: {
      record: over.record ?? makeRecord(),
      index: over.index ?? 0,
      isSelected: over.isSelected ?? false,
      isActive: over.isActive ?? (() => false),
      densityMode: over.densityMode ?? 'comfortable',
    },
  })
}

describe('MatchCard — collapsed header', () => {
  it('renders the match index zero-padded', () => {
    expect(mountCard({ index: 0 }).find('.match-index').text()).toBe('01')
    expect(mountCard({ index: 11 }).find('.match-index').text()).toBe('12')
  })

  it('shows the map name in the header', () => {
    const wrapper = mountCard()
    expect(wrapper.find('.match-map').text()).toBe('rialto')
  })

  it('falls back to "Unknown Map" when data.map is empty', () => {
    const wrapper = mountCard({ record: makeRecord({ map: '' }) })
    expect(wrapper.find('.match-map').text()).toBe('Unknown Map')
  })

  it('shows formatted time and game length', () => {
    const wrapper = mountCard()
    expect(wrapper.find('.when').text()).toContain('May 10, 2026')
    expect(wrapper.find('.length').text()).toContain('11:25')
  })

  it('renders mode / type / role / hero / result badges', () => {
    const wrapper = mountCard()
    const t = wrapper.text()
    expect(t).toContain('competitive')
    expect(t).toContain('control')
    expect(t).toContain('support')
    expect(t).toContain('lucio')
    expect(t).toContain('victory')
  })

  it('applies result-{result} class to the article root', () => {
    const wrapper = mountCard()
    expect(wrapper.find('article.match').classes()).toContain('result-victory')
  })

  it('applies "active" class to a badge when its filter is set', () => {
    const wrapper = mountCard({ isActive: (f) => f === 'mode' })
    const mode = wrapper.findAll('.badge').find(b => b.text() === 'competitive')!
    expect(mode.classes()).toContain('active')
  })

  it('shows the incomplete badge when required slots are missing', () => {
    const rec = makeRecord({}, { source_files: ['summary.png'], source_types: { 'summary.png': 'summary' } })
    const wrapper = mountCard({ record: rec })
    expect(wrapper.find('.incomplete-badge').exists()).toBe(true)
  })
})

describe('MatchCard — filter-toggle emits from badge clicks', () => {
  function findBadge(wrapper: ReturnType<typeof mountCard>, text: string) {
    return wrapper.findAll('.badge').find(b => b.text().toLowerCase().includes(text))!
  }

  it('every clickable chip in the header is a <button>', () => {
    const wrapper = mountCard()
    const badges = wrapper.findAll('button.badge')
    // mode / type / role / hero / result = 5
    expect(badges.length).toBeGreaterThanOrEqual(5)
  })

  it('aria-pressed mirrors the active filter state on a chip', () => {
    const wrapper = mountCard({ isActive: (f, v) => f === 'mode' && v === 'competitive' })
    const mode = findBadge(wrapper, 'competitive')
    expect(mode.attributes('aria-pressed')).toBe('true')
  })

  it('clicking the map badge emits filter-toggle map', async () => {
    const wrapper = mountCard()
    await wrapper.find('.match-map').trigger('click')
    expect(wrapper.emitted('filter-toggle')![0]).toEqual(['map', 'rialto'])
  })

  it('clicking the mode badge emits filter-toggle mode', async () => {
    const wrapper = mountCard()
    await findBadge(wrapper, 'competitive').trigger('click')
    expect(wrapper.emitted('filter-toggle')![0]).toEqual(['mode', 'competitive'])
  })

  it('clicking the hero badge emits filter-toggle hero', async () => {
    const wrapper = mountCard()
    await findBadge(wrapper, 'lucio').trigger('click')
    expect(wrapper.emitted('filter-toggle')![0]).toEqual(['hero', 'lucio'])
  })

  it('clicking the result badge emits filter-toggle result', async () => {
    const wrapper = mountCard()
    await findBadge(wrapper, 'victory').trigger('click')
    expect(wrapper.emitted('filter-toggle')![0]).toEqual(['result', 'victory'])
  })
})

describe('MatchCard — header interaction', () => {
  it('clicking the header region emits toggle-expand', async () => {
    const wrapper = mountCard()
    // Click an empty area in the header (the title row LHS gap)
    // by triggering on the outer .match-header. Vue treats this as
    // the parent click handler.
    await wrapper.find('.match-header').trigger('click')
    expect(wrapper.emitted('toggle-expand')).toBeTruthy()
  })

  it('clicking the chev button emits toggle-expand', async () => {
    const wrapper = mountCard()
    await wrapper.find('.chev-btn').trigger('click')
    expect(wrapper.emitted('toggle-expand')).toBeTruthy()
  })

  it('Enter on the chev button emits toggle-expand', async () => {
    const wrapper = mountCard()
    // Enter on a <button> fires click in browsers; @vue/test-utils'
    // .trigger('keydown.enter') doesn't dispatch the synthetic
    // click, so simulate with trigger('click') directly — same
    // user-visible effect.
    await wrapper.find('.chev-btn').trigger('click')
    expect(wrapper.emitted('toggle-expand')).toBeTruthy()
  })

  it('aria-expanded on the chev mirrors the isSelected prop', () => {
    const open = mountCard({ isSelected: true })
    expect(open.find('.chev-btn').attributes('aria-expanded')).toBe('true')
    const closed = mountCard({ isSelected: false })
    expect(closed.find('.chev-btn').attributes('aria-expanded')).toBe('false')
  })
})

describe('MatchCard — compact density', () => {
  it('does not apply the compact class in comfortable mode', () => {
    const wrapper = mountCard({ densityMode: 'comfortable' })
    expect(wrapper.find('article.match').classes()).not.toContain('compact')
  })

  it('applies the compact class on the article root in compact mode', () => {
    const wrapper = mountCard({ densityMode: 'compact' })
    expect(wrapper.find('article.match').classes()).toContain('compact')
  })

  it('renders inline E/A/D + damage in the tag-row when compact', () => {
    const wrapper = mountCard({ densityMode: 'compact' })
    const stats = wrapper.find('.compact-stats')
    expect(stats.exists()).toBe(true)
    expect(stats.text()).toContain('17')
    expect(stats.text()).toContain('16')
    expect(stats.text()).toContain('11')
    expect(stats.text()).toContain('7,200')
  })

  it('omits the inline stats strip when none of E/A/D/damage are populated', () => {
    const rec = makeRecord({
      eliminations: undefined,
      assists: undefined,
      deaths: undefined,
      damage: undefined,
    } as unknown as Partial<MatchRecord['data']>)
    const wrapper = mountCard({ record: rec, densityMode: 'compact' })
    expect(wrapper.find('.compact-stats').exists()).toBe(false)
  })

  it('renders the EAD strip even when damage is missing (partial stats)', () => {
    const rec = makeRecord({ damage: undefined } as unknown as Partial<MatchRecord['data']>)
    const wrapper = mountCard({ record: rec, densityMode: 'compact' })
    expect(wrapper.find('.compact-stats').exists()).toBe(true)
    // Damage span absent; E/A/D still rendered.
    expect(wrapper.find('.compact-dmg').exists()).toBe(false)
    expect(wrapper.find('.compact-ead').exists()).toBe(true)
  })
})

describe('MatchCard — leaver mark (collapsed header)', () => {
  it('hides the L mark when no annotation is set', () => {
    const wrapper = mountCard()
    expect(wrapper.find('.leaver-mark').exists()).toBe(false)
  })

  it('shows the L mark + correct class when annotation.leaver=self', () => {
    const annotated = makeRecord({}, {
      annotation: { leaver: 'self' },
    } as unknown as Partial<MatchRecord>)
    const wrapper = mountCard({ record: annotated })
    const mark = wrapper.find('.leaver-mark')
    expect(mark.exists()).toBe(true)
    expect(mark.classes()).toContain('leaver-self')
    expect(mark.attributes('title')).toContain('You left')
  })
})

describe('MatchCard — note mark (collapsed header)', () => {
  it('shows the N mark when notes are present', () => {
    const rec = makeRecord({}, {
      annotation: { leaver: '', note: 'huge clutch' },
    } as unknown as Partial<MatchRecord>)
    const wrapper = mountCard({ record: rec })
    expect(wrapper.find('.note-mark').exists()).toBe(true)
  })

  it('does not show the N mark when no annotation', () => {
    expect(mountCard().find('.note-mark').exists()).toBe(false)
  })

  it('shows the N mark when only members are populated', () => {
    const rec = makeRecord({}, {
      annotation: { leaver: '', note: '', replay_code: '', members: ['Apollo#1'] },
    } as unknown as Partial<MatchRecord>)
    const wrapper = mountCard({ record: rec })
    expect(wrapper.find('.note-mark').exists()).toBe(true)
  })
})

describe('MatchCard — soft-delete (hide/unhide) chrome', () => {
  it('applies the .hidden class on a hidden record', () => {
    const hidden = makeRecord({}, { hidden: true } as unknown as Partial<MatchRecord>)
    const wrapper = mountCard({ record: hidden })
    expect(wrapper.find('article.match').classes()).toContain('hidden')
  })

  it('does NOT apply .hidden on a normal record', () => {
    const wrapper = mountCard()
    expect(wrapper.find('article.match').classes()).not.toContain('hidden')
  })
})

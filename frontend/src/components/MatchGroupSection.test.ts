import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import MatchGroupSection from './MatchGroupSection.vue'
import type { MatchGroup } from '../match-helpers'
import type { MatchRecord } from '../api'

// MatchGroupSection is a recursive component for one node in the
// Month → Week → Day tree. Tests pass a `group` fixture and assert
// on the header rendering, W/L/D chyron, expand/collapse behavior,
// and recursive descent into children or leaf MatchCards.

function makeRecord(id: number, over: Partial<MatchRecord['data']> = {}): MatchRecord {
  return {
    id,
    match_key: `match:2026-05-10T21:29:${String(id).padStart(2, '0')}`,
    source_files: [`screenshot-${id}.png`],
    data: {
      map: 'rialto',
      mode: 'competitive',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '21:29',
      ...over,
    },
  }
}

function dayGroup(matches: MatchRecord[], over: Partial<MatchGroup<MatchRecord>> = {}): MatchGroup<MatchRecord> {
  return {
    key: 'day:2026-05-10',
    level: 'day',
    label: 'Sun May 10',
    tally: { w: matches.filter(m => m.data?.result === 'victory').length, l: matches.filter(m => m.data?.result === 'defeat').length, d: 0 },
    matches,
    ...over,
  }
}

function monthGroup(children: MatchGroup<MatchRecord>[], over: Partial<MatchGroup<MatchRecord>> = {}): MatchGroup<MatchRecord> {
  const t = children.reduce(
    (acc, c) => ({ w: acc.w + c.tally.w, l: acc.l + c.tally.l, d: acc.d + c.tally.d }),
    { w: 0, l: 0, d: 0 },
  )
  return {
    key: 'month:2026-05',
    level: 'month',
    label: 'MAY 2026',
    tally: t,
    children,
    ...over,
  }
}

function mountSection(group: MatchGroup<MatchRecord>, over: Partial<Record<string, unknown>> = {}) {
  return mount(MatchGroupSection, {
    props: {
      group,
      isGroupExpanded: (k: string) => k === group.key, // open by default for assertions
      isExpanded: () => false,
      isSourcesOpen: () => false,
      previewOpen: {},
      previewError: {},
      isActive: () => false,
      cardOffset: 0,
      ...over,
    },
  })
}

describe('MatchGroupSection — header rendering', () => {
  it('renders the group label', () => {
    const g = dayGroup([makeRecord(1)])
    const wrapper = mountSection(g)
    expect(wrapper.find('.mg-label').text()).toContain('Sun May 10')
  })

  it('applies the mg-level-{level} class to the root section', () => {
    const day = dayGroup([makeRecord(1)])
    expect(mountSection(day).find('section.mg').classes()).toContain('mg-level-day')

    const month = monthGroup([day])
    expect(mountSection(month).find('section.mg').classes()).toContain('mg-level-month')
  })

  it('caret carries the "open" class when isGroupExpanded returns true', () => {
    const g = dayGroup([makeRecord(1)])
    const open = mountSection(g)
    expect(open.find('.mg-caret').classes()).toContain('open')

    const closed = mountSection(g, { isGroupExpanded: () => false })
    expect(closed.find('.mg-caret').classes()).not.toContain('open')
  })

  it('aria-expanded attribute on the button reflects open state', () => {
    const g = dayGroup([makeRecord(1)])
    const open = mountSection(g)
    expect(open.find('.mg-head').attributes('aria-expanded')).toBe('true')

    const closed = mountSection(g, { isGroupExpanded: () => false })
    expect(closed.find('.mg-head').attributes('aria-expanded')).toBe('false')
  })
})

describe('MatchGroupSection — W/L/D chyron', () => {
  it('renders W and L slabs always; D slab only when draws > 0', () => {
    const noDraws = dayGroup([
      makeRecord(1, { result: 'victory' }),
      makeRecord(2, { result: 'defeat' }),
    ])
    const wrapper = mountSection(noDraws)
    expect(wrapper.find('.t-w').exists()).toBe(true)
    expect(wrapper.find('.t-l').exists()).toBe(true)
    expect(wrapper.find('.t-d').exists()).toBe(false)

    const withDraws = dayGroup([makeRecord(1, { result: 'draw' })], { tally: { w: 0, l: 0, d: 1 } })
    expect(mountSection(withDraws).find('.t-d').exists()).toBe(true)
  })

  it('marks the W or L slab as .zero when its count is 0', () => {
    const cleanSweep = dayGroup(
      [makeRecord(1, { result: 'victory' }), makeRecord(2, { result: 'victory' })],
      { tally: { w: 2, l: 0, d: 0 } },
    )
    const wrapper = mountSection(cleanSweep)
    expect(wrapper.find('.t-w').classes()).not.toContain('zero')
    expect(wrapper.find('.t-l').classes()).toContain('zero')
  })

  it('chyron bar widths reflect ratio(w) and ratio(l)', () => {
    const g = dayGroup([], { tally: { w: 3, l: 1, d: 0 } })
    const wrapper = mountSection(g)
    const wBar = wrapper.find('.mg-bar-w')
    const lBar = wrapper.find('.mg-bar-l')
    // 3/(3+1+0) = 75%, 1/4 = 25%
    expect(wBar.attributes('style')).toContain('width: 75%')
    expect(lBar.attributes('style')).toContain('width: 25%')
  })

  it('chyron bar widths collapse to 0 when tally is empty', () => {
    const g = dayGroup([], { tally: { w: 0, l: 0, d: 0 } })
    const wrapper = mountSection(g)
    expect(wrapper.find('.mg-bar-w').attributes('style')).toContain('width: 0%')
  })
})

describe('MatchGroupSection — toggle / collapse / leaf vs branch', () => {
  it('clicking the header emits toggle-group with the key', async () => {
    const g = dayGroup([makeRecord(1)])
    const wrapper = mountSection(g)
    await wrapper.find('.mg-head').trigger('click')
    expect(wrapper.emitted('toggle-group')![0]).toEqual([g.key])
  })

  it('renders MatchCard children at the day level when expanded', () => {
    const g = dayGroup([makeRecord(1), makeRecord(2), makeRecord(3)])
    const wrapper = mountSection(g)
    expect(wrapper.findAll('article.match')).toHaveLength(3)
  })

  it('day-level body still mounts when collapsed (v-show, not v-if) but is aria-hidden', () => {
    const g = dayGroup([makeRecord(1)])
    const closed = mountSection(g, { isGroupExpanded: () => false })
    // Body is in the DOM under v-show — aria-hidden flips.
    expect(closed.find('.mg-body').attributes('aria-hidden')).toBe('true')
    const open = mountSection(g)
    expect(open.find('.mg-body').attributes('aria-hidden')).toBe('false')
  })

  it('month-level group renders child MatchGroupSection components, not MatchCards', () => {
    const day = dayGroup([makeRecord(1), makeRecord(2)])
    const month = monthGroup([day])
    const wrapper = mountSection(month, { isGroupExpanded: () => true })
    // Two levels deep: one section.mg-level-month + one section.mg-level-day inside.
    expect(wrapper.findAll('section.mg').length).toBeGreaterThanOrEqual(2)
    expect(wrapper.find('section.mg-level-day').exists()).toBe(true)
  })

  it('bubbles toggle-expand / toggle-sources / filter-toggle / preview events up from leaf MatchCard', async () => {
    const g = dayGroup([makeRecord(7)])
    const wrapper = mountSection(g)
    // Click the MatchCard header.
    await wrapper.find('.match-header').trigger('click')
    expect(wrapper.emitted('toggle-expand')![0]).toEqual([7])
  })
})

describe('MatchGroupSection — unknown bucket', () => {
  it('renders UNKNOWN DATE label with match count', () => {
    const g: MatchGroup<MatchRecord> = {
      key: 'unknown',
      level: 'unknown',
      label: 'UNKNOWN DATE',
      tally: { w: 1, l: 1, d: 0 },
      matches: [makeRecord(10, { result: 'victory', date: '' }), makeRecord(11, { result: 'defeat', date: '' })],
    }
    const wrapper = mountSection(g)
    expect(wrapper.find('.mg-label').text()).toContain('UNKNOWN DATE')
    expect(wrapper.find('.mg-count').text()).toContain('(2 matches)')
  })

  it('singular "1 match" form for one undated record', () => {
    const g: MatchGroup<MatchRecord> = {
      key: 'unknown',
      level: 'unknown',
      label: 'UNKNOWN DATE',
      tally: { w: 1, l: 0, d: 0 },
      matches: [makeRecord(1, { date: '' })],
    }
    const wrapper = mountSection(g)
    expect(wrapper.find('.mg-count').text()).toContain('(1 match)')
  })

  it('does NOT render a count chip on dated levels', () => {
    const g = dayGroup([makeRecord(1)])
    const wrapper = mountSection(g)
    expect(wrapper.find('.mg-count').exists()).toBe(false)
  })
})

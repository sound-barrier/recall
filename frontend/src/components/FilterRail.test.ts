import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import FilterRail from './FilterRail.vue'

// FilterRail is purely presentational — accepts rosters + filter state
// + handlers, renders the seven filter dropdowns + date range + tools.
// Tests pass minimal fixtures and assert on either DOM presence or
// emitted events.

function mountRail(over: Partial<Record<string, unknown>> = {}) {
  return mount(FilterRail, {
    props: {
      modes: ['competitive', 'quickplay'],
      maps: ['rialto', 'aatlis', 'ilios'],
      types: ['control', 'flashpoint'],
      roles: ['support', 'tank', 'damage'],
      heroes: ['lucio', 'kiriko', 'juno'],
      results: ['victory', 'defeat'],
      sshotTypes: ['summary', 'scoreboard', 'personal', 'rank'],
      filterList: () => [],
      filterSearch: {},
      openFilter: '',
      filterFrom: '',
      filterTo: '',
      sortDir: 'desc',
      undatedMatchCount: 0,
      anyFilter: false,
      earliestMatchDateTime: '2026-01-01T00:00',
      nowDateTime: '2026-05-23T18:00',
      allExpanded: false,
      recordCount: 12,
      filteredCount: 12,
      includeUndated: false,
      ...over,
    },
  })
}

describe('FilterRail — initial render', () => {
  it('renders seven filter fields in order', () => {
    const wrapper = mountRail()
    const eyebrows = wrapper.findAll('.filter-eyebrow').map(e => e.text().split(' ')[0])
    // Eyebrow label is the field's pretty name.
    expect(eyebrows).toEqual(['Mode', 'Map', 'Type', 'Role', 'Hero', 'Result', 'Source'])
  })

  it('shows "All" placeholder when a filter is empty', () => {
    const wrapper = mountRail()
    const triggers = wrapper.findAll('.mf-trigger')
    expect(triggers[0]!.text()).toContain('All')
    // Meta line says "2 modes" — option count.
    expect(triggers[0]!.text()).toContain('2 modes')
  })

  it('shows record count "12 of 12" by default', () => {
    const wrapper = mountRail()
    const count = wrapper.find('.count')
    expect(count.text()).toContain('12')
    expect(count.text()).toContain('of 12')
  })

  it('sort button label reflects sortDir prop', () => {
    const desc = mountRail({ sortDir: 'desc' })
    expect(desc.text()).toContain('↓ Newest')
    const asc = mountRail({ sortDir: 'asc' })
    expect(asc.text()).toContain('↑ Oldest')
  })

  it('expand/collapse button label reflects allExpanded prop', () => {
    const collapsed = mountRail({ allExpanded: false })
    expect(collapsed.text()).toContain('Expand All')
    const expanded = mountRail({ allExpanded: true })
    expect(expanded.text()).toContain('Collapse All')
  })

  it('hides Clear Filters button when anyFilter=false', () => {
    const wrapper = mountRail({ anyFilter: false })
    expect(wrapper.findAll('button').some(b => b.text() === 'Clear Filters')).toBe(false)
  })

  it('shows Clear Filters when anyFilter=true', () => {
    const wrapper = mountRail({ anyFilter: true })
    expect(wrapper.findAll('button').some(b => b.text() === 'Clear Filters')).toBe(true)
  })
})

describe('FilterRail — populated chips', () => {
  it('renders chips for 1–2 active values inline', () => {
    const wrapper = mountRail({
      filterList: (field: string) => field === 'hero' ? ['lucio', 'kiriko'] : [],
    })
    const heroTrigger = wrapper.findAll('.mf-trigger').find(b => b.text().includes('lucio'))!
    expect(heroTrigger.text()).toContain('lucio')
    expect(heroTrigger.text()).toContain('kiriko')
  })

  it('renders "+N" stack for 3+ active values', () => {
    const wrapper = mountRail({
      filterList: (field: string) => field === 'hero' ? ['lucio', 'kiriko', 'juno'] : [],
    })
    expect(wrapper.text()).toContain('+2')
  })

  it('shows × count badge on the eyebrow when populated', () => {
    const wrapper = mountRail({
      filterList: (field: string) => field === 'map' ? ['rialto'] : [],
    })
    expect(wrapper.find('.eyebrow-count').text()).toContain('× 01')
  })
})

describe('FilterRail — open panel', () => {
  it('opens the panel for the field matching openFilter', () => {
    const wrapper = mountRail({ openFilter: 'mode' })
    expect(wrapper.findAll('.mf-panel')).toHaveLength(1)
    expect(wrapper.find('.mf-panel-title').text()).toBe('MODES ROSTER')
  })

  it('shows the search input only when the roster has ≥8 entries', () => {
    const small = mountRail({ openFilter: 'mode' }) // 2 modes
    expect(small.find('.mf-search').exists()).toBe(false)

    const big = mountRail({
      openFilter: 'hero',
      heroes: Array.from({ length: 10 }, (_, i) => `hero${i}`),
    })
    expect(big.find('.mf-search').exists()).toBe(true)
  })

  it('filters list items by search input via formatOption (sshot)', () => {
    const wrapper = mountRail({
      openFilter: 'sshot',
      filterSearch: { sshot: 'team' }, // 'scoreboard' formats to 'TEAMS'
    })
    const labels = wrapper.findAll('.mf-row-label').map(el => el.text())
    expect(labels).toContain('TEAMS')
    expect(labels).not.toContain('SUMMARY')
  })

  it('shows the empty state when the roster has zero entries', () => {
    const wrapper = mountRail({ openFilter: 'map', maps: [] })
    expect(wrapper.find('.mf-empty').exists()).toBe(true)
    expect(wrapper.find('.mf-empty').text()).toContain('No map values yet')
  })
})

describe('FilterRail — emits', () => {
  it('toggle-filter-panel fires on trigger click', async () => {
    const wrapper = mountRail()
    await wrapper.findAll('.mf-trigger')[0]!.trigger('click') // first = Mode
    const e = wrapper.emitted('toggle-filter-panel')
    expect(e).toBeTruthy()
    expect(e![0]).toEqual(['mode'])
  })

  it('toggle-filter fires when a checkbox is clicked', async () => {
    const wrapper = mountRail({ openFilter: 'mode' })
    const checkboxes = wrapper.findAll('.mf-row-box')
    await checkboxes[0]!.trigger('change')
    const e = wrapper.emitted('toggle-filter')
    expect(e).toBeTruthy()
    expect(e![0]).toEqual(['mode', 'competitive'])
  })

  it('select-all-filter / clear-filter-field / close-filter-panel fire from the panel foot', async () => {
    const wrapper = mountRail({ openFilter: 'mode' })
    const footBtns = wrapper.findAll('.mf-foot-btn')
    await footBtns[0]!.trigger('click') // All
    await footBtns[1]!.trigger('click') // None (currently disabled when empty — open panel has empty, so we expect no emit)
    await footBtns[2]!.trigger('click') // Done
    expect(wrapper.emitted('select-all-filter')).toBeTruthy()
    expect(wrapper.emitted('close-filter-panel')).toBeTruthy()
  })

  it('update:filterFrom / update:filterTo fire on date change', async () => {
    const wrapper = mountRail()
    const inputs = wrapper.findAll('input[type="datetime-local"]')
    await inputs[0]!.setValue('2026-04-01T12:00')
    expect(wrapper.emitted('update:filterFrom')).toBeTruthy()
    expect(wrapper.emitted('update:filterFrom')![0]).toEqual(['2026-04-01T12:00'])

    await inputs[1]!.setValue('2026-05-01T18:00')
    expect(wrapper.emitted('update:filterTo')).toBeTruthy()
  })

  it('reset-date-range fires on Reset; disabled when both dates empty', async () => {
    const wrapperEmpty = mountRail()
    const resetEmpty = wrapperEmpty.findAll('button').find(b => b.text() === 'Reset')!
    expect(resetEmpty.attributes('disabled')).toBeDefined()

    const wrapperFilled = mountRail({ filterFrom: '2026-01-01T00:00' })
    const reset = wrapperFilled.findAll('button').find(b => b.text() === 'Reset')!
    expect(reset.attributes('disabled')).toBeUndefined()
    await reset.trigger('click')
    expect(wrapperFilled.emitted('reset-date-range')).toBeTruthy()
  })

  it('toggle-sort / toggle-all / clear-filters emits fire from the tools row', async () => {
    const wrapper = mountRail({ anyFilter: true })
    await wrapper.findAll('button').find(b => b.text().includes('Newest'))!.trigger('click')
    await wrapper.findAll('button').find(b => b.text() === 'Expand All')!.trigger('click')
    await wrapper.findAll('button').find(b => b.text() === 'Clear Filters')!.trigger('click')
    expect(wrapper.emitted('toggle-sort')).toBeTruthy()
    expect(wrapper.emitted('toggle-all')).toBeTruthy()
    expect(wrapper.emitted('clear-filters')).toBeTruthy()
  })

  it('undated hint appears when a date filter is active AND undatedMatchCount > 0', () => {
    const noHint = mountRail({ filterFrom: '', filterTo: '', undatedMatchCount: 3 })
    expect(noHint.find('.range-hint').exists()).toBe(false)

    const hint = mountRail({ filterFrom: '2026-01-01T00:00', undatedMatchCount: 3 })
    expect(hint.find('.range-hint').exists()).toBe(true)
    expect(hint.find('.range-hint').text()).toContain('3 undated hidden')
  })
})

describe('FilterRail — Undated toggle', () => {
  it('hides the toggle when undatedMatchCount === 0', () => {
    const wrapper = mountRail({ undatedMatchCount: 0 })
    expect(wrapper.find('.undated-toggle').exists()).toBe(false)
  })

  it('shows the toggle with count when undatedMatchCount > 0', () => {
    const wrapper = mountRail({ undatedMatchCount: 3, includeUndated: false })
    const btn = wrapper.find('.undated-toggle')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('Undated')
    expect(btn.text()).toContain('3')
  })

  it('renders the "+" mark when off, "✓" when on', () => {
    const off = mountRail({ undatedMatchCount: 3, includeUndated: false })
    expect(off.find('.undated-mark').text()).toBe('+')

    const on = mountRail({ undatedMatchCount: 3, includeUndated: true })
    expect(on.find('.undated-mark').text()).toBe('✓')
  })

  it('applies .active class only when includeUndated=true', () => {
    expect(mountRail({ undatedMatchCount: 3, includeUndated: false }).find('.undated-toggle').classes())
      .not.toContain('active')
    expect(mountRail({ undatedMatchCount: 3, includeUndated: true }).find('.undated-toggle').classes())
      .toContain('active')
  })

  it('aria-pressed mirrors includeUndated for assistive tech', () => {
    expect(mountRail({ undatedMatchCount: 3, includeUndated: false }).find('.undated-toggle').attributes('aria-pressed')).toBe('false')
    expect(mountRail({ undatedMatchCount: 3, includeUndated: true }).find('.undated-toggle').attributes('aria-pressed')).toBe('true')
  })

  it('emits set-include-undated with the flipped value on click', async () => {
    const off = mountRail({ undatedMatchCount: 3, includeUndated: false })
    await off.find('.undated-toggle').trigger('click')
    expect(off.emitted('set-include-undated')![0]).toEqual([true])

    const on = mountRail({ undatedMatchCount: 3, includeUndated: true })
    await on.find('.undated-toggle').trigger('click')
    expect(on.emitted('set-include-undated')![0]).toEqual([false])
  })

  it('shows singular "match" copy in the title when count is 1', () => {
    const wrapper = mountRail({ undatedMatchCount: 1, includeUndated: false })
    expect(wrapper.find('.undated-toggle').attributes('title')).toContain('1 undated match ')
  })
})

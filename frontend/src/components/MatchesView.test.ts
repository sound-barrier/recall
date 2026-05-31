import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

import MatchesView from './MatchesView.vue'
import type { MatchRecord } from '../api'
import {
  createMatchesNarrowState,
  useMatchesNarrow,
} from '../composables/useMatchesNarrow'

// Unit tests for the bulk-select + Hidden drawer surfaces added in
// the matches-bulk-hide-archive feature. The end-to-end transport
// chain is covered by frontend/tests/e2e/match-bulk-hide-drawer.spec.ts;
// these mount the SFC directly so the branch coverage for the new
// state-machine code (bulk toggle, ticked-row class, archive expand,
// two-step delete) lives next to the template that exercises it.

function makeRecord(over: Partial<MatchRecord> = {}, dataOver: Partial<MatchRecord['data']> = {}): MatchRecord {
  return {
    match_key: 'match:2026-05-10T22:00:00',
    source_files: ['a.png'],
    data: {
      map: 'rialto',
      mode: 'competitive',
      type: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '22:00',
      eliminations: 10,
      assists: 5,
      deaths: 3,
      damage: 5000,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }],
      ...dataOver,
    },
    parsed_at: '2026-05-10T22:30:00Z',
    ...over,
  }
}

function mountView(records: MatchRecord[]) {
  const recordsRef = ref(records)
  const state = createMatchesNarrowState()
  const narrow = useMatchesNarrow(recordsRef, state)
  return mount(MatchesView, {
    props: { records, narrow },
    attachTo: document.body,
  })
}

describe('MatchesView — bulk-select mode', () => {
  it('Select toggle reveals per-row checkboxes without changing the row count', async () => {
    const records = [
      makeRecord({ match_key: 'match:2026-05-10T22:00:00' }),
      makeRecord({ match_key: 'match:2026-05-10T22:30:00' }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)

    expect(wrapper.findAll('.leaf-row')).toHaveLength(2)
    expect(wrapper.findAll('.leaf-checkbox')).toHaveLength(0)

    await wrapper.find('.bulk-select-toggle').trigger('click')

    expect(wrapper.findAll('.leaf-row')).toHaveLength(2)
    expect(wrapper.findAll('.leaf-checkbox')).toHaveLength(2)
    expect(wrapper.find('.bulk-select-toggle').classes()).toContain('engaged')
  })

  it('clicking a row in select mode ticks it and surfaces the action bar', async () => {
    const records = [
      makeRecord({ match_key: 'match:2026-05-10T22:00:00' }),
      makeRecord({ match_key: 'match:2026-05-10T22:30:00' }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)
    await wrapper.find('.bulk-select-toggle').trigger('click')

    expect(wrapper.find('.bulk-action-bar').exists()).toBe(false)

    await wrapper.findAll('.leaf-row')[0]!.trigger('click')
    expect(wrapper.findAll('.leaf-row')[0]!.classes()).toContain('is-ticked')
    expect(wrapper.find('.bulk-action-bar').exists()).toBe(true)
    expect(wrapper.find('.bab-count').text()).toContain('1 selected')

    // Tick the second too.
    await wrapper.findAll('.leaf-row')[1]!.trigger('click')
    expect(wrapper.find('.bab-count').text()).toContain('2 selected')

    // Click first again — unticks it.
    await wrapper.findAll('.leaf-row')[0]!.trigger('click')
    expect(wrapper.findAll('.leaf-row')[0]!.classes()).not.toContain('is-ticked')
    expect(wrapper.find('.bab-count').text()).toContain('1 selected')
  })

  it('Hide emits hide-matches with the ticked keys and exits select mode', async () => {
    const records = [
      makeRecord({ match_key: 'k1' }),
      makeRecord({ match_key: 'k2' }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)
    await wrapper.find('.bulk-select-toggle').trigger('click')
    await wrapper.findAll('.leaf-row')[0]!.trigger('click')
    await wrapper.findAll('.leaf-row')[1]!.trigger('click')

    await wrapper.find('.bulk-hide').trigger('click')

    const emitted = wrapper.emitted('hide-matches')
    expect(emitted).toBeTruthy()
    // Order follows row-tick order, which depends on the rendered
    // sort (newest first). Compare as sets so the test stays robust.
    expect([...(emitted![0]![0] as string[])].sort()).toEqual(['k1', 'k2'])
    // Mode resets — no action bar, no checkboxes.
    expect(wrapper.find('.bulk-action-bar').exists()).toBe(false)
    expect(wrapper.findAll('.leaf-checkbox')).toHaveLength(0)
  })

  it('Cancel clears the selection and exits select mode', async () => {
    const records = [makeRecord({ match_key: 'k1' })]
    const wrapper = mountView(records)
    await wrapper.find('.bulk-select-toggle').trigger('click')
    await wrapper.findAll('.leaf-row')[0]!.trigger('click')

    await wrapper.find('.bulk-cancel').trigger('click')

    expect(wrapper.find('.bulk-action-bar').exists()).toBe(false)
    expect(wrapper.findAll('.leaf-checkbox')).toHaveLength(0)
    expect(wrapper.find('.bulk-select-toggle').classes()).not.toContain('engaged')
  })

  it('clicking a row outside select mode emits open-match (and not toggleSelected)', async () => {
    const records = [makeRecord({ match_key: 'k1' })]
    const wrapper = mountView(records)

    await wrapper.findAll('.leaf-row')[0]!.trigger('click')

    expect(wrapper.emitted('open-match')).toEqual([['k1']])
    expect(wrapper.emitted('hide-matches')).toBeFalsy()
  })
})

describe('MatchesView — Hidden drawer', () => {
  it('does not render the Archive section when nothing is hidden', () => {
    const records = [makeRecord({ match_key: 'k1' })]
    const wrapper = mountView(records)
    expect(wrapper.find('.archive').exists()).toBe(false)
  })

  it('surfaces a count chip and singular noun for one hidden match', async () => {
    const records = [
      makeRecord({ match_key: 'k1' }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)

    expect(wrapper.find('.archive').exists()).toBe(true)
    expect(wrapper.find('.archive-count').text()).toBe('1')
    expect(wrapper.find('.archive-noun').text()).toBe('hidden match')
    // Collapsed by default → no list.
    expect(wrapper.findAll('.archive-row')).toHaveLength(0)
  })

  it('pluralizes the noun for multiple hidden matches', () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)
    expect(wrapper.find('.archive-noun').text()).toBe('hidden matches')
  })

  it('expand reveals the hidden rows with Unhide + Delete forever actions', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')

    expect(wrapper.findAll('.archive-row')).toHaveLength(2)
    expect(wrapper.findAll('.archive-unhide')).toHaveLength(2)
    expect(wrapper.findAll('.archive-delete')).toHaveLength(2)
    expect(wrapper.find('.archive-chev').classes()).toContain('open')
  })

  it('Unhide emits unhide-match with the row key', async () => {
    const records = [makeRecord({ match_key: 'k1', hidden: true })]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')
    await wrapper.find('.archive-unhide').trigger('click')

    expect(wrapper.emitted('unhide-match')).toEqual([['k1']])
  })

  it('Delete forever is a two-step: first click reveals Confirm + Cancel without emitting', async () => {
    const records = [makeRecord({ match_key: 'k1', hidden: true })]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')

    await wrapper.find('.archive-delete').trigger('click')

    expect(wrapper.find('.archive-confirm').exists()).toBe(true)
    expect(wrapper.find('.archive-cancel').exists()).toBe(true)
    expect(wrapper.find('.archive-delete').exists()).toBe(false)
    expect(wrapper.emitted('hard-delete-match')).toBeFalsy()
  })

  it('Confirm emits hard-delete-match with the row key', async () => {
    const records = [makeRecord({ match_key: 'k1', hidden: true })]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')
    await wrapper.find('.archive-delete').trigger('click')
    await wrapper.find('.archive-confirm').trigger('click')

    expect(wrapper.emitted('hard-delete-match')).toEqual([['k1']])
  })

  it('Cancel from the confirm state reverts to the action buttons without emitting', async () => {
    const records = [makeRecord({ match_key: 'k1', hidden: true })]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')
    await wrapper.find('.archive-delete').trigger('click')
    await wrapper.find('.archive-cancel').trigger('click')

    expect(wrapper.find('.archive-delete').exists()).toBe(true)
    expect(wrapper.find('.archive-confirm').exists()).toBe(false)
    expect(wrapper.emitted('hard-delete-match')).toBeFalsy()
  })
})

describe('MatchesView — campaign log hidden filter', () => {
  it('hidden matches drop out of the timeline so visibleRecords feeds it', () => {
    // The MatchTimelineHeader is `v-if="visibleRecords.length > 0"`.
    // With every record hidden, the header should not render at all,
    // proving the filter wired through.
    const records = [makeRecord({ match_key: 'k1', hidden: true })]
    const wrapper = mountView(records)
    expect(wrapper.find('.campaign-log').exists()).toBe(false)
  })
})

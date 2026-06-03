import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

import MatchesView from './MatchesView.vue'
import type { MatchRecord } from '../api'
import {
  createMatchesNarrowState,
  useMatchesNarrow,
} from '../composables/useMatchesNarrow'

// Unit tests for the contextual multi-select + Hidden drawer surfaces.
// End-to-end transport chain is covered by
// frontend/tests/e2e/match-bulk-hide-drawer.spec.ts; these mount the
// SFC directly so the branch coverage for the new state-machine code
// (per-row checkbox toggle, sticky action bar, bulk archive ops, two-
// step confirms) lives next to the template that exercises it.

function makeRecord(over: Partial<MatchRecord> = {}, dataOver: Partial<MatchRecord['data']> = {}): MatchRecord {
  return {
    match_key: 'match-2026-05-10T22-00-00',
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

describe('MatchesView — contextual multi-select (live rows)', () => {
  it('checkboxes are always in the DOM — no mode toggle needed', () => {
    const records = [
      makeRecord({ match_key: 'k1' }),
      makeRecord({ match_key: 'k2' }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)

    expect(wrapper.find('.bulk-select-toggle').exists()).toBe(false)
    expect(wrapper.findAll('.leaf-row')).toHaveLength(2)
    expect(wrapper.findAll('.leaf-checkbox')).toHaveLength(2)
    expect(wrapper.find('.bulk-action-bar').exists()).toBe(false)
  })

  it('checkbox click ticks the row and stops the row body click from firing open-match', async () => {
    const records = [makeRecord({ match_key: 'k1' })]
    const wrapper = mountView(records)

    await wrapper.find('.leaf-checkbox').trigger('click')

    expect(wrapper.find('.leaf-row').classes()).toContain('is-ticked')
    expect(wrapper.find('.leaf-row').classes()).toContain('has-selection')
    expect(wrapper.find('.bulk-action-bar').exists()).toBe(true)
    expect(wrapper.find('.bab-count').text()).toContain('1 selected')
    // The checkbox click must NOT have bubbled into the row's open-match handler.
    expect(wrapper.emitted('open-match')).toBeFalsy()
  })

  it('row body click still opens the detail panel even while a selection exists', async () => {
    const records = [
      makeRecord({ match_key: 'k1' }),
      makeRecord({ match_key: 'k2' }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)

    // Tick the first row, then click the body of the second row.
    await wrapper.findAll('.leaf-checkbox')[0]!.trigger('click')
    await wrapper.findAll('.leaf-row')[1]!.trigger('click')

    // Row click opens the detail; the second row should NOT have been
    // ticked, and the existing selection should still be 1.
    expect(wrapper.emitted('open-match')?.[0]).toBeTruthy()
    expect(wrapper.findAll('.leaf-row')[1]!.classes()).not.toContain('is-ticked')
    expect(wrapper.find('.bab-count').text()).toContain('1 selected')
  })

  it('Select all targets every visible row; the button hides once everything is ticked', async () => {
    const records = [
      makeRecord({ match_key: 'k1' }),
      makeRecord({ match_key: 'k2' }, { finished_at: '22:30' }),
      makeRecord({ match_key: 'k3' }, { finished_at: '23:00' }),
    ]
    const wrapper = mountView(records)

    // Tick one to surface the action bar.
    await wrapper.findAll('.leaf-checkbox')[0]!.trigger('click')
    expect(wrapper.find('.bulk-select-all').text()).toContain('Select all (3)')

    await wrapper.find('.bulk-select-all').trigger('click')
    expect(wrapper.findAll('.leaf-row.is-ticked')).toHaveLength(3)
    expect(wrapper.find('.bab-count').text()).toContain('3 selected')
    // When the selection covers everything visible, Select all is
    // redundant and disappears.
    expect(wrapper.find('.bulk-select-all').exists()).toBe(false)
  })

  it('Hide emits hide-matches with every ticked key and clears the selection', async () => {
    const records = [
      makeRecord({ match_key: 'k1' }),
      makeRecord({ match_key: 'k2' }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)
    await wrapper.findAll('.leaf-checkbox')[0]!.trigger('click')
    await wrapper.findAll('.leaf-checkbox')[1]!.trigger('click')

    await wrapper.find('.bulk-hide').trigger('click')

    const emitted = wrapper.emitted('hide-matches')
    expect(emitted).toBeTruthy()
    expect([...(emitted![0]![0] as string[])].sort()).toEqual(['k1', 'k2'])
    expect(wrapper.find('.bulk-action-bar').exists()).toBe(false)
    expect(wrapper.findAll('.leaf-row.is-ticked')).toHaveLength(0)
  })

  it('Clear empties the selection without emitting', async () => {
    const records = [makeRecord({ match_key: 'k1' })]
    const wrapper = mountView(records)
    await wrapper.find('.leaf-checkbox').trigger('click')

    await wrapper.find('.bulk-cancel').trigger('click')

    expect(wrapper.find('.bulk-action-bar').exists()).toBe(false)
    expect(wrapper.find('.leaf-row').classes()).not.toContain('is-ticked')
    expect(wrapper.emitted('hide-matches')).toBeFalsy()
  })

  it('un-ticking the last row removes the action bar', async () => {
    const records = [makeRecord({ match_key: 'k1' })]
    const wrapper = mountView(records)

    await wrapper.find('.leaf-checkbox').trigger('click')
    expect(wrapper.find('.bulk-action-bar').exists()).toBe(true)

    await wrapper.find('.leaf-checkbox').trigger('click')
    expect(wrapper.find('.bulk-action-bar').exists()).toBe(false)
    expect(wrapper.find('.leaf-row').classes()).not.toContain('is-ticked')
  })
})

describe('MatchesView — Hidden drawer', () => {
  it('does not render the Archive section when nothing is hidden', () => {
    const records = [makeRecord({ match_key: 'k1' })]
    const wrapper = mountView(records)
    expect(wrapper.find('.archive').exists()).toBe(false)
  })

  it('surfaces a count chip and singular noun for one hidden match', () => {
    const records = [
      makeRecord({ match_key: 'k1' }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)

    expect(wrapper.find('.archive').exists()).toBe(true)
    expect(wrapper.find('.archive-count').text()).toBe('1')
    expect(wrapper.find('.archive-noun').text()).toBe('hidden match')
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

  it('expand reveals the hidden rows with per-row checkbox + Unhide + Delete forever', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')

    expect(wrapper.findAll('.archive-row')).toHaveLength(2)
    expect(wrapper.findAll('.archive-checkbox')).toHaveLength(2)
    expect(wrapper.findAll('.archive-unhide')).toHaveLength(2)
    expect(wrapper.findAll('.archive-delete')).toHaveLength(2)
    expect(wrapper.find('.archive-chev').classes()).toContain('open')
  })

  it('per-row Unhide still works as a single-target action', async () => {
    const records = [makeRecord({ match_key: 'k1', hidden: true })]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')
    await wrapper.find('.archive-unhide').trigger('click')

    expect(wrapper.emitted('unhide-match')).toEqual([['k1']])
  })

  it('per-row Delete forever is a two-step inline confirm', async () => {
    const records = [makeRecord({ match_key: 'k1', hidden: true })]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')

    await wrapper.find('.archive-delete').trigger('click')
    expect(wrapper.find('.archive-confirm').exists()).toBe(true)
    expect(wrapper.find('.archive-cancel').exists()).toBe(true)
    expect(wrapper.find('.archive-delete').exists()).toBe(false)
    expect(wrapper.emitted('hard-delete-match')).toBeFalsy()

    await wrapper.find('.archive-confirm').trigger('click')
    expect(wrapper.emitted('hard-delete-match')).toEqual([['k1']])
  })

  it('per-row Delete forever Cancel reverts to action buttons without emitting', async () => {
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

describe('MatchesView — Archive bulk selection', () => {
  it('archive checkbox click ticks the row and surfaces the archive action bar', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')

    expect(wrapper.find('.archive-action-bar').exists()).toBe(false)
    await wrapper.findAll('.archive-checkbox')[0]!.trigger('click')

    expect(wrapper.findAll('.archive-row')[0]!.classes()).toContain('is-ticked')
    expect(wrapper.find('.archive-action-bar').exists()).toBe(true)
    expect(wrapper.find('.archive-action-bar .bab-count').text()).toContain('1 selected')
  })

  it('archive Select all targets every hidden row; button hides at full coverage', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
      makeRecord({ match_key: 'k3', hidden: true }, { finished_at: '23:00' }),
    ]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')
    await wrapper.findAll('.archive-checkbox')[0]!.trigger('click')

    expect(wrapper.find('.archive-action-bar .bulk-select-all').text()).toContain('Select all (3)')

    await wrapper.find('.archive-action-bar .bulk-select-all').trigger('click')
    expect(wrapper.findAll('.archive-row.is-ticked')).toHaveLength(3)
    expect(wrapper.find('.archive-action-bar .bab-count').text()).toContain('3 selected')
    expect(wrapper.find('.archive-action-bar .bulk-select-all').exists()).toBe(false)
  })

  it('Unhide on the archive action bar emits unhide-matches and clears the selection', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')
    await wrapper.findAll('.archive-checkbox')[0]!.trigger('click')
    await wrapper.findAll('.archive-checkbox')[1]!.trigger('click')

    await wrapper.find('.bulk-unhide').trigger('click')

    const emitted = wrapper.emitted('unhide-matches')
    expect(emitted).toBeTruthy()
    expect([...(emitted![0]![0] as string[])].sort()).toEqual(['k1', 'k2'])
    expect(wrapper.find('.archive-action-bar').exists()).toBe(false)
  })

  it('bulk Delete forever is a two-step confirm; Confirm emits hard-delete-matches', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')
    await wrapper.findAll('.archive-checkbox')[0]!.trigger('click')
    await wrapper.findAll('.archive-checkbox')[1]!.trigger('click')

    await wrapper.find('.bulk-delete').trigger('click')
    // Confirm UI takes over the bar; primary actions disappear.
    expect(wrapper.find('.bab-warn-text').exists()).toBe(true)
    expect(wrapper.find('.bab-warn-text').text()).toContain('Delete 2 matches from the database')
    expect(wrapper.find('.bulk-confirm').exists()).toBe(true)
    expect(wrapper.find('.bulk-delete').exists()).toBe(false)
    expect(wrapper.find('.bulk-unhide').exists()).toBe(false)
    expect(wrapper.emitted('hard-delete-matches')).toBeFalsy()

    await wrapper.find('.bulk-confirm').trigger('click')
    const emitted = wrapper.emitted('hard-delete-matches')
    expect(emitted).toBeTruthy()
    expect([...(emitted![0]![0] as string[])].sort()).toEqual(['k1', 'k2'])
    // Selection cleared.
    expect(wrapper.find('.archive-action-bar').exists()).toBe(false)
  })

  it('bulk Delete forever warn-text uses singular noun for one ticked match', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')
    await wrapper.findAll('.archive-checkbox')[0]!.trigger('click')

    await wrapper.find('.bulk-delete').trigger('click')
    expect(wrapper.find('.bab-warn-text').text()).toContain('Delete 1 match from the database')
  })

  it('bulk Delete forever Cancel reverts to primary actions without emitting', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')
    await wrapper.findAll('.archive-checkbox')[0]!.trigger('click')
    await wrapper.find('.bulk-delete').trigger('click')

    await wrapper.find('.bulk-cancel').trigger('click')

    expect(wrapper.find('.bulk-delete').exists()).toBe(true)
    expect(wrapper.find('.bulk-unhide').exists()).toBe(true)
    expect(wrapper.find('.bulk-confirm').exists()).toBe(false)
    // Selection survives the cancel — user can revise it before retrying.
    expect(wrapper.findAll('.archive-row.is-ticked')).toHaveLength(1)
    expect(wrapper.emitted('hard-delete-matches')).toBeFalsy()
  })

  it('toggling the selection while in bulk-confirm aborts the confirm state', async () => {
    const records = [
      makeRecord({ match_key: 'k1', hidden: true }),
      makeRecord({ match_key: 'k2', hidden: true }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)
    await wrapper.find('.archive-toggle').trigger('click')
    await wrapper.findAll('.archive-checkbox')[0]!.trigger('click')
    await wrapper.find('.bulk-delete').trigger('click')
    expect(wrapper.find('.bulk-confirm').exists()).toBe(true)

    // Add the second row to the selection — the prior "Confirm" no
    // longer means the same thing, so the bar reverts to primaries.
    await wrapper.findAll('.archive-checkbox')[1]!.trigger('click')
    expect(wrapper.find('.bulk-confirm').exists()).toBe(false)
    expect(wrapper.find('.bulk-delete').exists()).toBe(true)
  })
})

describe('MatchesView — Move to profile picker', () => {
  // The Move-to picker fetches /api/v1/profiles on mount. Stub the
  // api module so the SFC sees a fixture state with one other
  // profile available.
  it('Move to… is suppressed when no other profile exists', async () => {
    const records = [makeRecord({ match_key: 'k1' })]
    const wrapper = mountView(records)
    await wrapper.find('.leaf-checkbox').trigger('click')
    // Default mountApp mock returns profiles=['main'] — no others.
    expect(wrapper.find('.bulk-move').exists()).toBe(false)
  })

  it('clicking Move to… reveals the target picker (when other profiles exist)', async () => {
    const records = [makeRecord({ match_key: 'k1' })]
    const wrapper = mountView(records)

    // Inject a fixture availableProfiles state directly (skips the
    // onMount fetch which the unit test isn't trying to exercise).
    // The component exposes availableProfiles via setup return for
    // template binding; we reach in via the public-ish `vm` for the
    // test only.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any
    vm.availableProfiles = { active: 'main', profiles: ['alt', 'main'] }
    await wrapper.vm.$nextTick()

    await wrapper.find('.leaf-checkbox').trigger('click')
    await wrapper.find('.bulk-move').trigger('click')

    expect(wrapper.find('.bab-prompt').exists()).toBe(true)
    const targets = wrapper.findAll('.bulk-move-target')
    expect(targets).toHaveLength(1)
    expect(targets[0]!.text()).toBe('alt')
  })

  it('clicking a target chip emits move-matches with the ticked keys + target', async () => {
    const records = [
      makeRecord({ match_key: 'k1' }),
      makeRecord({ match_key: 'k2' }, { finished_at: '22:30' }),
    ]
    const wrapper = mountView(records)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any
    vm.availableProfiles = { active: 'main', profiles: ['alt', 'main'] }
    await wrapper.vm.$nextTick()

    await wrapper.findAll('.leaf-checkbox')[0]!.trigger('click')
    await wrapper.findAll('.leaf-checkbox')[1]!.trigger('click')
    await wrapper.find('.bulk-move').trigger('click')
    await wrapper.find('.bulk-move-target').trigger('click')

    const emitted = wrapper.emitted('move-matches')
    expect(emitted).toBeTruthy()
    const [keys, target] = emitted![0]!
    expect([...(keys as string[])].sort()).toEqual(['k1', 'k2'])
    expect(target).toBe('alt')
    // Picker resets after commit.
    expect(wrapper.find('.bab-prompt').exists()).toBe(false)
  })

  it('Cancel reverts the picker without emitting', async () => {
    const records = [makeRecord({ match_key: 'k1' })]
    const wrapper = mountView(records)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any
    vm.availableProfiles = { active: 'main', profiles: ['alt', 'main'] }
    await wrapper.vm.$nextTick()

    await wrapper.find('.leaf-checkbox').trigger('click')
    await wrapper.find('.bulk-move').trigger('click')
    await wrapper.find('.bulk-cancel').trigger('click')

    expect(wrapper.find('.bab-prompt').exists()).toBe(false)
    expect(wrapper.find('.bulk-move').exists()).toBe(true)
    expect(wrapper.emitted('move-matches')).toBeFalsy()
  })
})

describe('MatchesView — campaign log hidden filter', () => {
  it('hidden matches drop out of the timeline (visibleRecords feeds it)', () => {
    const records = [makeRecord({ match_key: 'k1', hidden: true })]
    const wrapper = mountView(records)
    expect(wrapper.find('.campaign-log').exists()).toBe(false)
  })
})

describe('MatchesView — infinite-scroll window', () => {
  function fillCorpus(n: number): MatchRecord[] {
    return Array.from({ length: n }, (_, i) => {
      const k = String(i).padStart(3, '0')
      // Spread across days so groupBy='day' (the default) produces
      // multiple sections — verifies the windowing logic respects
      // section boundaries (not just a flat row count).
      const day = String(10 + (i % 5)).padStart(2, '0')
      return makeRecord(
        { match_key: `match-2026-05-${day}T${k}` },
        { date: `2026-05-${day}`, finished_at: `${String(i % 24).padStart(2, '0')}:${k.slice(-2)}` },
      )
    })
  }

  it('renders exactly DEFAULT_PAGE_SIZE (20) leaf-rows for a 50-row corpus', () => {
    const wrapper = mountView(fillCorpus(50))
    expect(wrapper.findAll('.leaf-row')).toHaveLength(20)
  })

  it('shows the sentinel + "Showing 20 of 50 matches" foot', () => {
    const wrapper = mountView(fillCorpus(50))
    expect(wrapper.find('[data-testid="leaves-sentinel"]').exists()).toBe(true)
    const foot = wrapper.find('[data-testid="leaves-foot"]')
    expect(foot.exists()).toBe(true)
    expect(foot.text()).toContain('Showing 20 of 50 matches')
  })

  it('omits the sentinel + reads "Showing all N matches" when corpus fits', () => {
    const wrapper = mountView(fillCorpus(7))
    expect(wrapper.findAll('.leaf-row')).toHaveLength(7)
    expect(wrapper.find('[data-testid="leaves-sentinel"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="leaves-foot"]').text()).toContain('Showing all 7')
  })

  it('foot has aria-live=polite + role=status for screen-reader updates', () => {
    const wrapper = mountView(fillCorpus(50))
    const foot = wrapper.find('[data-testid="leaves-foot"]')
    expect(foot.attributes('role')).toBe('status')
    expect(foot.attributes('aria-live')).toBe('polite')
  })
})

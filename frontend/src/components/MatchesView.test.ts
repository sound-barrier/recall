import { describe, expect, it } from 'vitest'
import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import { mount } from '@vue/test-utils'

import MatchesView, { type CardStateApi } from './MatchesView.vue'
import { useMatchFilters } from '../composables/useMatchFilters'
import { useFilterPanel } from '../composables/useFilterPanel'
import { useMatchGrouping } from '../composables/useMatchGrouping'
import type { MatchRecord } from '../api'

// MatchesView extracted from App.vue. Tests mount it with real
// composables seeded by fixtures — that way we exercise the same code
// path App.vue does, but without dragging in the rest of the SFC's
// onMounted side effects.

function makeCardState(records: MatchRecord[]): { api: CardStateApi; expanded: Ref<Record<number, boolean>> } {
  const expanded = ref<Record<number, boolean>>({})
  const previewOpen = ref<Record<string, boolean>>({})
  const previewError = ref<Record<string, boolean>>({})
  const sourcesOpen = ref<Record<number, boolean>>({})

  const api: CardStateApi = {
    isExpanded: (id: number) => !!expanded.value[id],
    isSourcesOpen: (id: number) => !!sourcesOpen.value[id],
    previewOpen,
    previewError,
    allExpanded: computed(() => records.length > 0 && records.every(r => !!expanded.value[r.id])),
    toggleAll: () => {
      const any = records.some(r => !!expanded.value[r.id])
      const next: Record<number, boolean> = {}
      for (const r of records) next[r.id] = !any
      expanded.value = next
    },
    toggleExpand: (id: number) => { expanded.value = { ...expanded.value, [id]: !expanded.value[id] } },
    toggleSources: (id: number) => { sourcesOpen.value = { ...sourcesOpen.value, [id]: !sourcesOpen.value[id] } },
    togglePreview: () => undefined,
    onPreviewError: () => undefined,
  }
  return { api, expanded }
}

function mountWith(records: MatchRecord[]) {
  const recsRef = ref(records)
  const filters = useMatchFilters(recsRef)
  const filterPanel = useFilterPanel()
  const grouping = useMatchGrouping<MatchRecord>(filters.filteredSorted, filters.sortDir)
  const { api: cardState } = makeCardState(records)

  const wrapper = mount(MatchesView, {
    props: {
      records,
      loading: false,
      filters,
      filterPanel,
      grouping,
      cardState,
      earliestMatchDateTime: '',
      nowDateTime: '2026-05-23T18:00',
    },
  })
  return { wrapper, filters, grouping, cardState }
}

describe('MatchesView', () => {
  it('renders the empty state when no records are loaded', () => {
    const { wrapper } = mountWith([])
    expect(wrapper.text()).toContain('No matches on record.')
    // FilterRail must NOT mount on an empty record set.
    expect(wrapper.find('.filter-rail').exists()).toBe(false)
  })

  it('emits go-to-view when an empty-state link is clicked', async () => {
    const { wrapper } = mountWith([])
    const link = wrapper.findAll('.empty-link')[0]!
    await link.trigger('click')
    expect(wrapper.emitted('go-to-view')).toBeTruthy()
    expect(wrapper.emitted('go-to-view')![0]).toEqual(['settings'])
  })

  it('renders the FilterRail and group list once records are present', () => {
    const { wrapper } = mountWith([
      { id: 1, match_key: 'match:2026-05-10T21:29:28', source_files: ['a.png'], data: {
        map: 'rialto', date: '2026-05-10', finished_at: '21:29', result: 'victory', mode: 'competitive',
      } },
    ])
    // Empty state must be gone.
    expect(wrapper.text()).not.toContain('No matches on record.')
    // FilterRail is on (asserted via role=toolbar exposed by FilterRail's
    // root or by its known class name — checking the most stable string).
    expect(wrapper.find('.filter-rail').exists()).toBe(true)
    // Group rail with month count appears.
    expect(wrapper.text()).toMatch(/1 month\b/)
    // The month label itself.
    expect(wrapper.text()).toContain('MAY 2026')
  })

  it('renders the UNKNOWN DATE bucket when a record lacks a date', () => {
    const { wrapper } = mountWith([
      { id: 1, match_key: 'unmatched:scoreboard.png', source_files: ['scoreboard.png'], data: {
        map: 'rialto', mode: 'competitive', result: 'victory',
      } },
    ])
    expect(wrapper.text()).toContain('UNKNOWN DATE')
  })

  it('Expand-all button flips the group tree state', async () => {
    const { wrapper, grouping } = mountWith([
      { id: 1, match_key: 'match:2026-05-10T21:29:28', source_files: ['a.png'], data: {
        map: 'rialto', date: '2026-05-10', finished_at: '21:29', result: 'victory', mode: 'competitive',
      } },
      { id: 2, match_key: 'match:2026-04-15T20:00:00', source_files: ['b.png'], data: {
        map: 'aatlis', date: '2026-04-15', finished_at: '20:00', result: 'defeat', mode: 'competitive',
      } },
    ])
    // Initial state: not all expanded (only newest path is auto-open).
    expect(grouping.allExpanded.value).toBe(false)

    // Click Expand all.
    const btn = wrapper.findAll('button').find(b => b.text().includes('Expand all'))
    expect(btn).toBeDefined()
    await btn!.trigger('click')
    expect(grouping.allExpanded.value).toBe(true)
  })
})

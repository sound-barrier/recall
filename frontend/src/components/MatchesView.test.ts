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

function makeCardState(records: MatchRecord[]): { api: CardStateApi; expanded: Ref<Record<string, boolean>> } {
  const expanded = ref<Record<string, boolean>>({})
  const previewOpen = ref<Record<string, boolean>>({})
  const previewError = ref<Record<string, boolean>>({})
  const sourcesOpen = ref<Record<string, boolean>>({})

  const api: CardStateApi = {
    isExpanded: (id: string) => !!expanded.value[id],
    isSourcesOpen: (id: string) => !!sourcesOpen.value[id],
    previewOpen,
    previewError,
    allExpanded: computed(() => records.length > 0 && records.every(r => !!expanded.value[r.match_key])),
    toggleAll: () => {
      const any = records.some(r => !!expanded.value[r.match_key])
      const next: Record<string, boolean> = {}
      for (const r of records) next[r.match_key] = !any
      expanded.value = next
    },
    toggleExpand: (id: string) => { expanded.value = { ...expanded.value, [id]: !expanded.value[id] } },
    toggleSources: (id: string) => { sourcesOpen.value = { ...sourcesOpen.value, [id]: !sourcesOpen.value[id] } },
    togglePreview: () => undefined,
    onPreviewError: () => undefined,
  }
  return { api, expanded }
}

function mountWith(records: MatchRecord[], includeUndated = false) {
  const recsRef = ref(records)
  const includeUndatedRef = ref(includeUndated)
  // Pass the ref into useMatchFilters so the same flag flows through
  // both `filtered` (filter logic) and `undatedMatchCount` etc.
  const filters = useMatchFilters(recsRef, includeUndatedRef)
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
      includeUndated,
      minPlayPercent: 0,
      minPlayMinutes: 0,
      densityMode: 'comfortable' as const,
      leaverHandling: 'include' as const,
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
      { match_key: 'match:2026-05-10T21:29:28', source_files: ['a.png'], data: {
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

  it('renders the UNKNOWN DATE bucket when a record lacks a date and includeUndated=true', () => {
    const { wrapper } = mountWith([
      { match_key: 'unmatched:scoreboard.png', source_files: ['scoreboard.png'], data: {
        map: 'rialto', mode: 'competitive', result: 'victory',
      } },
    ], /* includeUndated */ true)
    expect(wrapper.text()).toContain('UNKNOWN DATE')
  })

  it('hides the UNKNOWN DATE bucket when includeUndated=false (default), but the rail toggle stays visible', () => {
    const { wrapper } = mountWith([
      { match_key: 'unmatched:scoreboard.png', source_files: ['scoreboard.png'], data: {
        map: 'rialto', mode: 'competitive', result: 'victory',
      } },
    ]) // includeUndated defaults to false
    // No bucket — the dateless record was filtered out before grouping.
    expect(wrapper.text()).not.toContain('UNKNOWN DATE')
    // But the FilterRail toggle is visible, showing the user the
    // count of records they could opt into.
    expect(wrapper.find('.undated-toggle').exists()).toBe(true)
    expect(wrapper.find('.undated-toggle').text()).toContain('Undated · 1')
    // Empty state checks raw records.length, not filtered, so it
    // does NOT render here — the user has parsed matches; they're
    // just hidden.
    expect(wrapper.text()).not.toContain('No matches on record.')
  })

  it('Expand-all button flips the group tree state', async () => {
    const { wrapper, grouping } = mountWith([
      { match_key: 'match:2026-05-10T21:29:28', source_files: ['a.png'], data: {
        map: 'rialto', date: '2026-05-10', finished_at: '21:29', result: 'victory', mode: 'competitive',
      } },
      { match_key: 'match:2026-04-15T20:00:00', source_files: ['b.png'], data: {
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

  it('renders the density toggle in the group-rail', () => {
    const { wrapper } = mountWith([
      { match_key: 'match:1', source_files: ['a.png'], data: { map: 'rialto', date: '2026-05-10', finished_at: '21:29' } },
    ])
    const density = wrapper.find('.density-btn')
    expect(density.exists()).toBe(true)
    expect(density.text()).toContain('Comfy')
    expect(density.attributes('aria-pressed')).toBe('false')
  })

  it('emits toggle-density when the density button is clicked', async () => {
    const { wrapper } = mountWith([
      { match_key: 'match:1', source_files: ['a.png'], data: { map: 'rialto', date: '2026-05-10', finished_at: '21:29' } },
    ])
    await wrapper.find('.density-btn').trigger('click')
    expect(wrapper.emitted('toggle-density')).toBeTruthy()
  })

  it('reflects compact mode in the density button label + active state + list class', async () => {
    const wrapper = mount(MatchesView, {
      props: {
        records: [{ match_key: 'match:1', source_files: ['a.png'], data: { map: 'rialto', date: '2026-05-10', finished_at: '21:29' } }],
        loading: false,
        filters: useMatchFilters(ref([{ match_key: 'match:1', source_files: ['a.png'], data: { map: 'rialto', date: '2026-05-10', finished_at: '21:29' } }] as MatchRecord[]), ref(false)),
        filterPanel: useFilterPanel(),
        grouping: useMatchGrouping<MatchRecord>(
          (() => {
            const recs: MatchRecord[] = [{ match_key: 'match:1', source_files: ['a.png'], data: { map: 'rialto', date: '2026-05-10', finished_at: '21:29' } }]
            return useMatchFilters(ref(recs), ref(false)).filteredSorted
          })(),
          ref<'asc' | 'desc'>('desc'),
        ),
        cardState: makeCardState([{ match_key: 'match:1', source_files: ['a.png'], data: { map: 'rialto', date: '2026-05-10', finished_at: '21:29' } }]).api,
        earliestMatchDateTime: '',
        nowDateTime: '2026-05-23T18:00',
        includeUndated: false,
        minPlayPercent: 0,
        minPlayMinutes: 0,
        densityMode: 'compact' as const,
        leaverHandling: 'include' as const,
      },
    })
    const density = wrapper.find('.density-btn')
    expect(density.classes()).toContain('active')
    expect(density.attributes('aria-pressed')).toBe('true')
    expect(density.text()).toContain('Compact')
    expect(wrapper.find('.match-list').classes()).toContain('compact')
  })
})

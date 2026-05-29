import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'

import UnknownMapsView from './UnknownMapsView.vue'
import type { CardStateApi } from './MatchesView.vue'
import type { MatchRecord } from '../api'

// Shared with MatchesView: per-card state owned by the parent so both
// views can share expand / preview behavior. The fake here just
// records calls so we can assert the view bubbles them upward.
function makeCardState(records: MatchRecord[]) {
  const expanded = ref<Record<string, boolean>>({})
  const previewOpen = ref<Record<string, boolean>>({})
  const previewError = ref<Record<string, boolean>>({})
  const sourcesOpen = ref<Record<string, boolean>>({})
  const calls = { toggleExpand: 0, togglePreview: 0 }
  const api: CardStateApi = {
    isSelected: (id: string) => !!expanded.value[id],
    isSourcesOpen: (id: string) => !!sourcesOpen.value[id],
    previewOpen,
    previewError,
    toggleExpand: (id: string) => {
      calls.toggleExpand++
      expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
    },
    toggleSources: () => undefined,
    togglePreview: () => { calls.togglePreview++ },
    onPreviewError: () => undefined,
  }
  return { api, expanded, calls }
}

function mountWith(records: MatchRecord[]) {
  const { api: cardState, calls } = makeCardState(records)
  const wrapper = mount(UnknownMapsView, {
    props: { unknownRecords: records, cardState },
  })
  return { wrapper, calls }
}

describe('UnknownMapsView', () => {
  it('renders the all-resolved state when there are no unknown records', () => {
    const { wrapper } = mountWith([])
    expect(wrapper.text()).toContain('All screenshots resolved.')
    // Empty-state copy.
    expect(wrapper.text()).toContain('No unresolved records.')
    // No cards rendered.
    expect(wrapper.findAll('.unknown-card')).toHaveLength(0)
  })

  it('renders one card per unknown record with the right match key', () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched:scoreboard1.png', source_files: ['scoreboard1.png'], data: {
        eliminations: 17, assists: 16, deaths: 11, result: 'victory',
      } },
      { match_key: 'unmatched:broken.png', source_files: ['broken.png'], data: {} },
    ]
    const { wrapper } = mountWith(records)
    expect(wrapper.findAll('.unknown-card')).toHaveLength(2)
    expect(wrapper.text()).toContain('unmatched:scoreboard1.png')
    expect(wrapper.text()).toContain('unmatched:broken.png')
    // The heading reflects the count.
    expect(wrapper.text()).toMatch(/2 records.*couldn't be matched/)
  })

  it('emits go-to-view when "run Parse" link is clicked', async () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched:x.png', source_files: ['x.png'], data: {} },
    ]
    const { wrapper } = mountWith(records)
    const link = wrapper.findAll('.empty-link').find(el => el.text().toLowerCase().includes('parse'))
    expect(link).toBeDefined()
    await link!.trigger('click')
    expect(wrapper.emitted('go-to-view')).toBeTruthy()
    expect(wrapper.emitted('go-to-view')![0]).toEqual(['ingest'])
  })

  it('clicking the card head delegates to cardState.toggleExpand', async () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched:x.png', source_files: ['x.png'], data: {} },
    ]
    const { wrapper, calls } = mountWith(records)
    await wrapper.find('.unknown-card-head').trigger('click')
    expect(calls.toggleExpand).toBe(1)
  })

  it('shows the field diagnostic strip with vacant cells for missing values', () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched:x.png', source_files: ['x.png'], data: {} },
    ]
    const { wrapper } = mountWith(records)
    const filledCells = wrapper.findAll('.field-cell.filled')
    const vacantCells = wrapper.findAll('.field-cell.vacant')
    expect(filledCells).toHaveLength(0)
    expect(vacantCells.length).toBeGreaterThan(0)
  })
})

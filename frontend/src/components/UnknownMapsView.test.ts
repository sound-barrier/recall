import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'

import UnknownMapsView from './UnknownMapsView.vue'
import type { CardStateApi } from '../types/cardState'
import type { MatchRecord } from '../api'

// Shared with MatchesView: per-card state owned by the parent so both
// views can share expand / preview behavior. The fake here just
// records calls so we can assert the view bubbles them upward.
function makeCardState(_records: MatchRecord[]) {
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
    togglePreview: (filename: string) => {
      // Realistic toggle so the <img v-if="previewOpen[f]"> actually
      // renders when the test clicks the source-name affordance.
      // Click-to-open-lightbox tests need the img in the DOM.
      calls.togglePreview++
      previewOpen.value = { ...previewOpen.value, [filename]: !previewOpen.value[filename] }
    },
    onPreviewError: () => undefined,
  }
  return { api, expanded, calls }
}

function mountWith(records: MatchRecord[], extras: Partial<{ ambiguousRecords: MatchRecord[]; allRecords: MatchRecord[] }> = {}) {
  const { api: cardState, calls } = makeCardState(records)
  const wrapper = mount(UnknownMapsView, {
    props: {
      unknownRecords: records,
      ambiguousRecords: extras.ambiguousRecords ?? [],
      allRecords: extras.allRecords ?? [],
      cardState,
    },
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
    expect(wrapper.text()).toMatch(/2 records.*need your attention/)
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

  // ─── Ambiguous attribution surface ─────────────────────────

  it('renders the "Needs your review" subheading with the ambiguous count', () => {
    const ambig: MatchRecord[] = [
      {
        match_key: 'ambiguous:scoreboard-2.png',
        source_files: ['scoreboard-2.png'],
        data: { hero: 'lucio' },
        ambiguous: true,
        candidates: [{ match_key: 'match:foo', distance_seconds: 720 }],
      },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig })
    expect(wrapper.text()).toContain('Needs your review — 1')
    expect(wrapper.findAll('.ambiguous-card')).toHaveLength(1)
  })

  it('expanding an ambiguous card surfaces the candidate picker', async () => {
    const ambig: MatchRecord[] = [
      {
        match_key: 'ambiguous:scoreboard-2.png',
        source_files: ['scoreboard-2.png'],
        data: { hero: 'lucio' },
        ambiguous: true,
        candidates: [{ match_key: 'match:foo', distance_seconds: 720 }],
      },
    ]
    const all: MatchRecord[] = [
      {
        match_key: 'match:foo', source_files: ['sb1.png'],
        data: { map: 'rialto', hero: 'lucio', date: '2026-05-10' },
      },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig, allRecords: all })
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    expect(wrapper.findAll('.candidate-row')).toHaveLength(1)
    expect(wrapper.text()).toContain('12 min apart')
    expect(wrapper.text()).toContain('rialto')
  })

  it('clicking Attach emits resolve-ambiguous with the candidate key', async () => {
    const ambig: MatchRecord[] = [
      {
        match_key: 'ambiguous:scoreboard-2.png',
        source_files: ['scoreboard-2.png'],
        data: { hero: 'lucio' },
        ambiguous: true,
        candidates: [{ match_key: 'match:foo', distance_seconds: 720 }],
      },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig })
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    await wrapper.find('.candidate-attach').trigger('click')
    const emitted = wrapper.emitted('resolve-ambiguous')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual(['ambiguous:scoreboard-2.png', 'match:foo'])
  })

  it('"Treat as new match" mints a fresh match:<ts> key from the filename', async () => {
    const ambig: MatchRecord[] = [
      {
        match_key: 'ambiguous:Overwatch 2 Screenshot 2026.05.10 - 21.41.28.00_scoreboard.png',
        source_files: ['Overwatch 2 Screenshot 2026.05.10 - 21.41.28.00_scoreboard.png'],
        data: {},
        ambiguous: true,
        candidates: [{ match_key: 'match:old', distance_seconds: 720 }],
      },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig })
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    await wrapper.find('.candidate-fresh').trigger('click')
    const emitted = wrapper.emitted('resolve-ambiguous')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![1]).toBe('match:2026-05-10T21:41:28')
  })

  // ─── Screenshot preview → fullscreen lightbox ──────────────
  //
  // The Unknown tab's Source Files list shows a small preview
  // thumbnail per file when the user toggles it open (same
  // chevron-on-the-filename interaction as MatchDetailPanel's side-
  // panel sources block). Clicking that thumbnail used to do nothing
  // — the `<img>` had no @click handler. Parity with the side panel
  // means clicking the thumbnail opens the fullscreen lightbox via
  // an `open-lightbox` event the parent (App.vue) routes to the
  // existing MatchScreenshotLightbox component.

  it('clicking a source-preview thumbnail in an Unknown card emits open-lightbox', async () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched:x.png', source_files: ['x.png'], data: {} },
    ]
    const { wrapper } = mountWith(records)
    // Expand the card so the Source Files block renders.
    await wrapper.find('.unknown-card-head').trigger('click')
    // Flip the preview open so the <img> exists.
    await wrapper.find('.source-name').trigger('click')
    const img = wrapper.find('img.source-preview')
    expect(img.exists()).toBe(true)
    await img.trigger('click')
    expect(wrapper.emitted('open-lightbox')).toBeTruthy()
    // Emit signature: (filename, source_files). The second arg is
    // the owning record's source_files so the lightbox can navigate
    // between screenshots of the same match.
    expect(wrapper.emitted('open-lightbox')![0]).toEqual(['x.png', ['x.png']])
  })

  // Ambiguous cards historically had no Source Files block — the
  // user picks a candidate without seeing the actual screenshot,
  // which is unhelpful. Same Source Files block as the Unknown
  // card now renders inside the expanded ambiguous card so the
  // user can preview + open-lightbox the screenshot they're
  // triaging.
  it('ambiguous card surfaces a Source Files preview that emits open-lightbox', async () => {
    const ambig: MatchRecord[] = [
      {
        match_key: 'ambiguous:ambig-sb.png',
        source_files: ['ambig-sb.png'],
        data: {},
        ambiguous: true,
        candidates: [{ match_key: 'match:foo', distance_seconds: 720 }],
      },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig })
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    // The Source Files block must render inside the expanded
    // ambiguous card AND honour the same toggle-preview gesture as
    // the Unknown card.
    const sourceName = wrapper.find('.ambiguous-card .source-name')
    expect(sourceName.exists()).toBe(true)
    await sourceName.trigger('click')
    const img = wrapper.find('.ambiguous-card img.source-preview')
    expect(img.exists()).toBe(true)
    await img.trigger('click')
    expect(wrapper.emitted('open-lightbox')).toBeTruthy()
    // Emit signature: (filename, source_files).
    expect(wrapper.emitted('open-lightbox')![0]).toEqual(['ambig-sb.png', ['ambig-sb.png']])
  })
})

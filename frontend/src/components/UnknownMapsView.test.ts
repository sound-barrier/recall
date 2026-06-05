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
    // Post item-8: every preview field is a function. The test
    // fake closes over the same refs the production wiring would
    // expose, so togglePreview keeps the realistic toggle that
    // lets the lightbox click-to-open path render its <img>.
    isPreviewOpen:   (filename: string) => !!previewOpen.value[filename],
    hasPreviewError: (filename: string) => !!previewError.value[filename],
    toggleExpand: (id: string) => {
      calls.toggleExpand++
      expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
    },
    toggleSources: () => undefined,
    togglePreview: (filename: string) => {
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
      preloadScreenshot: () => undefined,
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
      { match_key: 'unmatched-scoreboard1.png', source_files: ['scoreboard1.png'], data: {
        eliminations: 17, assists: 16, deaths: 11, result: 'victory',
      } },
      { match_key: 'unmatched-broken.png', source_files: ['broken.png'], data: {} },
    ]
    const { wrapper } = mountWith(records)
    expect(wrapper.findAll('.unknown-card')).toHaveLength(2)
    expect(wrapper.text()).toContain('unmatched-scoreboard1.png')
    expect(wrapper.text()).toContain('unmatched-broken.png')
    // The heading reflects the count.
    expect(wrapper.text()).toMatch(/2 records.*need your attention/)
  })

  it('emits go-to-view when "run Parse" link is clicked', async () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
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
      { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
    ]
    const { wrapper, calls } = mountWith(records)
    await wrapper.find('.unknown-card-head').trigger('click')
    expect(calls.toggleExpand).toBe(1)
  })

  it('shows the field diagnostic strip with vacant cells for missing values', () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
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
        match_key: 'ambiguous-scoreboard-2.png',
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
        match_key: 'ambiguous-scoreboard-2.png',
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
        match_key: 'ambiguous-scoreboard-2.png',
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
    expect(emitted![0]).toEqual(['ambiguous-scoreboard-2.png', 'match:foo'])
  })

  it('"Treat as new match" mints a fresh match:<ts> key from the filename', async () => {
    const ambig: MatchRecord[] = [
      {
        match_key: 'ambiguous-Overwatch 2 Screenshot 2026.05.10 - 21.41.28.00_scoreboard.png',
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
    expect(emitted![0]![1]).toBe('match-2026-05-10T21-41-28')
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
      { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
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
    // Open-lightbox now carries a third arg: per-file dir-id map.
    // The test record has no source_dir_ids → empty object.
    expect(wrapper.emitted('open-lightbox')![0]).toEqual(['x.png', ['x.png'], {}])
  })

  // Ambiguous cards historically had no Source Files block — the
  // user picks a candidate without seeing the actual screenshot,
  // which is unhelpful. The Source Files block now auto-opens on
  // card expand (no extra chevron click) so the user can preview +
  // open-lightbox the screenshot they're triaging in one gesture.
  it('expanding an ambiguous card auto-opens the source-screenshot preview', async () => {
    const ambig: MatchRecord[] = [
      {
        match_key: 'ambiguous-ambig-sb.png',
        source_files: ['ambig-sb.png'],
        data: {},
        ambiguous: true,
        candidates: [{ match_key: 'match:foo', distance_seconds: 720 }],
      },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig })
    // ONE click on the card head — no extra source-name click needed.
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    const img = wrapper.find('.ambiguous-card img.source-preview')
    expect(img.exists()).toBe(true)
    // Click the inline preview escalates to the lightbox.
    await img.trigger('click')
    expect(wrapper.emitted('open-lightbox')).toBeTruthy()
    expect(wrapper.emitted('open-lightbox')![0]).toEqual(['ambig-sb.png', ['ambig-sb.png'], {}])
  })

  // Collapsing the card (second click on the head) must close the
  // auto-opened preview — otherwise toggling expand→collapse→expand
  // would have to also toggle the chevron arrow to avoid stuck state.
  it('collapsing an auto-opened ambiguous card closes the preview', async () => {
    const ambig: MatchRecord[] = [
      {
        match_key: 'ambiguous-ambig-sb.png',
        source_files: ['ambig-sb.png'],
        data: {},
        ambiguous: true,
        candidates: [{ match_key: 'match:foo', distance_seconds: 720 }],
      },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig })
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    expect(wrapper.find('.ambiguous-card img.source-preview').exists()).toBe(true)
    // The card-head click toggles expand, which removes the source
    // preview from the DOM. The togglePreview state is sticky but
    // user-invisible while collapsed.
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    expect(wrapper.find('.ambiguous-card img.source-preview').exists()).toBe(false)
  })

  // Side-by-side preview pane: the candidate-picker now puts a
  // larger preview slot next to the candidate list so the user can
  // compare the source screenshot against the candidate's
  // representative image without escalating to the lightbox.
  it('candidate-picker renders a side-by-side preview pane on the first candidate by default', async () => {
    const ambig: MatchRecord[] = [
      {
        match_key: 'ambiguous-ambig-sb.png',
        source_files: ['ambig-sb.png'],
        data: {},
        ambiguous: true,
        candidates: [
          { match_key: 'match:a', distance_seconds: 60, representative_source_file: 'a-sum.png' },
          { match_key: 'match:b', distance_seconds: 120, representative_source_file: 'b-sum.png' },
        ],
      },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig })
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    const pane = wrapper.find('.candidate-preview-pane')
    expect(pane.exists()).toBe(true)
    // First candidate is active by default; pane image points at it.
    const img = pane.find('img')
    expect(img.attributes('src')).toContain(encodeURIComponent('a-sum.png'))
    // Active class lit on the first row.
    expect(wrapper.find('.candidate-row.active').exists()).toBe(true)
  })

  it('hovering a different candidate updates the preview pane', async () => {
    const ambig: MatchRecord[] = [
      {
        match_key: 'ambiguous-ambig-sb.png',
        source_files: ['ambig-sb.png'],
        data: {},
        ambiguous: true,
        candidates: [
          { match_key: 'match:a', distance_seconds: 60, representative_source_file: 'a-sum.png' },
          { match_key: 'match:b', distance_seconds: 120, representative_source_file: 'b-sum.png' },
        ],
      },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig })
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    const rows = wrapper.findAll('.candidate-row')
    await rows[1]!.trigger('mouseenter')
    const img = wrapper.find('.candidate-preview-pane img')
    expect(img.attributes('src')).toContain(encodeURIComponent('b-sum.png'))
  })

  // ── Hover thumbnail (FEATURES.md: "Inline image preview on Unknown")
  //
  // The thumb is <Teleport>'d to <body> so wrapper.find() doesn't see
  // it — Vue test-utils only walks the wrapper subtree. Query through
  // document.querySelector for these assertions instead. Tests attach
  // to document.body so the teleported nodes land in a deterministic
  // place and clean up on wrapper.unmount() (handled implicitly by
  // each test ending).
  describe('hover thumbnail on collapsed cards', () => {
    function mountAttached(records: MatchRecord[]) {
      const { api: cardState, calls } = makeCardState(records)
      const wrapper = mount(UnknownMapsView, {
        props: {
          unknownRecords: records,
          ambiguousRecords: [],
          allRecords: [],
          cardState,
          preloadScreenshot: () => undefined,
        },
        attachTo: document.body,
      })
      return { wrapper, calls }
    }

    function fireMouseenter(wrapper: ReturnType<typeof mountAttached>['wrapper']) {
      return wrapper.find('.unknown-card').trigger('mouseenter', { clientX: 200, clientY: 300 })
    }

    it('renders a floating thumbnail with the first source URL on mouseenter', async () => {
      const records: MatchRecord[] = [
        { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
      ]
      const { wrapper } = mountAttached(records)
      try {
        expect(document.querySelector('.unknown-hover-thumb')).toBeNull()
        await fireMouseenter(wrapper)
        const thumb = document.querySelector<HTMLImageElement>('.unknown-hover-thumb')
        expect(thumb).not.toBeNull()
        expect(thumb!.getAttribute('src')).toMatch(/_screenshot\/0\/x\.png/)
      } finally {
        wrapper.unmount()
      }
    })

    it('disappears on mouseleave', async () => {
      const records: MatchRecord[] = [
        { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
      ]
      const { wrapper } = mountAttached(records)
      try {
        await fireMouseenter(wrapper)
        expect(document.querySelector('.unknown-hover-thumb')).not.toBeNull()
        await wrapper.find('.unknown-card').trigger('mouseleave')
        expect(document.querySelector('.unknown-hover-thumb')).toBeNull()
      } finally {
        wrapper.unmount()
      }
    })

    it('does not render when the card is already expanded', async () => {
      const records: MatchRecord[] = [
        { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
      ]
      const { wrapper } = mountAttached(records)
      try {
        await wrapper.find('.unknown-card-head').trigger('click')
        await fireMouseenter(wrapper)
        expect(document.querySelector('.unknown-hover-thumb')).toBeNull()
      } finally {
        wrapper.unmount()
      }
    })

    it('does not render when the record has no source_files', async () => {
      const records: MatchRecord[] = [
        { match_key: 'unmatched-empty', source_files: [], data: {} },
      ]
      const { wrapper } = mountAttached(records)
      try {
        await fireMouseenter(wrapper)
        expect(document.querySelector('.unknown-hover-thumb')).toBeNull()
      } finally {
        wrapper.unmount()
      }
    })

    it('uses the first source_file when a record has several', async () => {
      const records: MatchRecord[] = [
        { match_key: 'unmatched-multi', source_files: ['first.png', 'second.png'], data: {} },
      ]
      const { wrapper } = mountAttached(records)
      try {
        await fireMouseenter(wrapper)
        const thumb = document.querySelector<HTMLImageElement>('.unknown-hover-thumb')
        expect(thumb!.getAttribute('src')).toMatch(/first\.png/)
      } finally {
        wrapper.unmount()
      }
    })

    it('updates position on mousemove inside the hovered card', async () => {
      const records: MatchRecord[] = [
        { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
      ]
      const { wrapper } = mountAttached(records)
      try {
        await wrapper.find('.unknown-card').trigger('mouseenter', { clientX: 50, clientY: 80 })
        const thumb = document.querySelector<HTMLElement>('.unknown-hover-thumb')!
        const firstLeft = thumb.style.left
        await wrapper.find('.unknown-card').trigger('mousemove', { clientX: 240, clientY: 380 })
        // Anchored to the cursor — the inline left/top changes between
        // mouseenter (50,80) and mousemove (240,380).
        expect(thumb.style.left).not.toBe(firstLeft)
      } finally {
        wrapper.unmount()
      }
    })
  })

  // ── Preload on mount (warms the browser HTTP cache so hover-time
  //    fetches don't race the mouseleave-cancellation window). Item 12
  //    moved the request-issuing to useScreenshotPreview; this view
  //    just calls the injected `preloadScreenshot` prop for each
  //    visible record's first source file.
  describe('screenshot preload on view mount', () => {
    function mountWithPreloadCapture(records: MatchRecord[]) {
      const { api: cardState } = makeCardState(records)
      const calls: string[] = []
      mount(UnknownMapsView, {
        props: {
          unknownRecords: records,
          ambiguousRecords: [],
          allRecords: [],
          cardState,
          preloadScreenshot: (url: string) => { calls.push(url) },
        },
      })
      return calls
    }

    it('calls preloadScreenshot once per record with its first source file URL', () => {
      const records: MatchRecord[] = [
        { match_key: 'unmatched-one.png', source_files: ['one.png'], data: {} },
        { match_key: 'unmatched-two.png', source_files: ['two.png', 'twoB.png'], data: {} },
      ]
      const calls = mountWithPreloadCapture(records)
      expect(calls).toContain('/_screenshot/0/one.png')
      expect(calls).toContain('/_screenshot/0/two.png')
      // Only the first source per record is preloaded — twoB shouldn't
      // be touched. The expanded view's per-file thumbnails carry the
      // rest of the load.
      expect(calls).not.toContain('/_screenshot/0/twoB.png')
    })

    it('skips records with no source_files', () => {
      const records: MatchRecord[] = [
        { match_key: 'unmatched-empty', source_files: [], data: {} },
      ]
      const calls = mountWithPreloadCapture(records)
      expect(calls).toHaveLength(0)
    })
  })
})

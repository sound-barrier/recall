import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import UnknownMapsView from '@/components/unknown/UnknownMapsView.vue'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'
import { ResolveAmbiguousMatch } from '@/api'
import type { MatchRecord, UpdateInfo } from '@/api'

// UnknownMapsView reads its triage lists + per-card state + actions from the
// stores now: the unknown/ambiguous/reference-gap getters off the matches
// store, the source-preview/lightbox state from the UI store, updateInfo from
// the app store, and resolve/ignore from useMatchActions. These tests seed the
// stores + assert the api calls / store state the view drives (no props/emits).
// Keep '@/api' real except the resolve/ignore calls (asserted) + GetMatchResults
// (so the store's boot reload doesn't hit the transport).
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  GetMatchResults:       vi.fn(async () => []),
  ResolveAmbiguousMatch: vi.fn(async () => undefined),
  IgnoreScreenshot:      vi.fn(async () => undefined),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

interface Extras {
  ambiguousRecords?:    MatchRecord[]
  referenceGapRecords?: MatchRecord[]
  allRecords?:          MatchRecord[]
  updateInfo?:          UpdateInfo | null
}

// Seeds the matches store with the union of fixtures (the predicate getters
// partition them back out) + the app store's updateInfo, and spies on the UI
// store's preload + openLightbox before mount so the view's setup captures them.
function mountWith(records: MatchRecord[], extras: Extras = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const union = [
    ...records,
    ...(extras.ambiguousRecords ?? []),
    ...(extras.referenceGapRecords ?? []),
    ...(extras.allRecords ?? []),
  ]
  const seen = new Set<string>()
  const matches = useMatchesStore()
  matches.records = union.filter((r) => {
    if (seen.has(r.match_key)) return false
    seen.add(r.match_key)
    return true
  })
  const app = useAppStore()
  app.updateInfo = extras.updateInfo ?? null
  const ui = useUiStore()
  const preloadSpy = vi.spyOn(ui.preview, 'preload')
  const openLightboxSpy = vi.spyOn(ui.preview, 'openLightbox')
  const wrapper = mount(UnknownMapsView, { global: { plugins: [pinia] }, attachTo: document.body })
  return { wrapper, app, ui, preloadSpy, openLightboxSpy }
}

describe('UnknownMapsView', () => {
  it('renders the all-resolved state when there are no unknown records', () => {
    const { wrapper } = mountWith([])
    expect(wrapper.text()).toContain('All screenshots resolved.')
    expect(wrapper.text()).toContain('No unresolved records.')
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
    expect(wrapper.text()).toMatch(/2 records.*need your attention/)
  })

  it('navigates to the Parse tab when the "run Parse" link is clicked', async () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
    ]
    const { wrapper, app } = mountWith(records)
    const link = wrapper.findAll('.empty-link').find(el => el.text().toLowerCase().includes('parse'))
    expect(link).toBeDefined()
    await link!.trigger('click')
    expect(app.view).toBe('ingest')
  })

  it('clicking the card head expands it (opens the source block)', async () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
    ]
    const { wrapper } = mountWith(records)
    expect(wrapper.find('.source-name').exists()).toBe(false)
    await wrapper.find('.unknown-card-head').trigger('click')
    expect(wrapper.find('.source-name').exists()).toBe(true)
  })

  it('shows the field diagnostic strip with vacant cells for missing values', () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
    ]
    const { wrapper } = mountWith(records)
    expect(wrapper.findAll('.field-cell.filled')).toHaveLength(0)
    expect(wrapper.findAll('.field-cell.vacant').length).toBeGreaterThan(0)
  })

  // ─── Ambiguous attribution surface ─────────────────────────

  it('renders the "Needs your review" subheading with the ambiguous count', () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-scoreboard-2.png', source_files: ['scoreboard-2.png'], data: { hero: 'lucio' },
        ambiguous: true, candidates: [{ match_key: 'match:foo', distance_seconds: 720 }] },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig })
    expect(wrapper.text()).toContain('Needs your review — 1')
    expect(wrapper.findAll('.ambiguous-card')).toHaveLength(1)
  })

  it('expanding an ambiguous card surfaces the candidate picker', async () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-scoreboard-2.png', source_files: ['scoreboard-2.png'], data: { hero: 'lucio' },
        ambiguous: true, candidates: [{ match_key: 'match:foo', distance_seconds: 720 }] },
    ]
    const all: MatchRecord[] = [
      { match_key: 'match:foo', source_files: ['sb1.png'], data: { map: 'rialto', hero: 'lucio', date: '2026-05-10' } },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig, allRecords: all })
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    expect(wrapper.findAll('.candidate-row')).toHaveLength(1)
    expect(wrapper.text()).toContain('12 min apart')
    expect(wrapper.text()).toContain('rialto')
  })

  it('clicking Attach resolves the ambiguous record to the candidate key', async () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-scoreboard-2.png', source_files: ['scoreboard-2.png'], data: { hero: 'lucio' },
        ambiguous: true, candidates: [{ match_key: 'match:foo', distance_seconds: 720 }] },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig })
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    await wrapper.find('.candidate-attach').trigger('click')
    expect(ResolveAmbiguousMatch).toHaveBeenCalledWith('ambiguous-scoreboard-2.png', 'match:foo')
  })

  it('"Treat as new match" mints a fresh match-<ts> key from the filename', async () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-Overwatch 2 Screenshot 2026.05.10 - 21.41.28.00_scoreboard.png',
        source_files: ['Overwatch 2 Screenshot 2026.05.10 - 21.41.28.00_scoreboard.png'], data: {},
        ambiguous: true, candidates: [{ match_key: 'match:old', distance_seconds: 720 }] },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig })
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    await wrapper.find('.candidate-fresh').trigger('click')
    expect(ResolveAmbiguousMatch).toHaveBeenCalled()
    expect((ResolveAmbiguousMatch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]).toBe('match-2026-05-10T21-41-28')
  })

  // ─── Screenshot preview → fullscreen lightbox ──────────────

  it('clicking a source-preview thumbnail opens the lightbox via the UI store', async () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
    ]
    const { wrapper, openLightboxSpy } = mountWith(records)
    await wrapper.find('.unknown-card-head').trigger('click')
    await wrapper.find('.source-name').trigger('click')
    const img = wrapper.find('img.source-preview')
    expect(img.exists()).toBe(true)
    await img.trigger('click')
    expect(openLightboxSpy).toHaveBeenCalledWith('x.png', ['x.png'], {})
  })

  it('expanding an ambiguous card auto-opens the source-screenshot preview', async () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-ambig-sb.png', source_files: ['ambig-sb.png'], data: {},
        ambiguous: true, candidates: [{ match_key: 'match:foo', distance_seconds: 720 }] },
    ]
    const { wrapper, openLightboxSpy } = mountWith([], { ambiguousRecords: ambig })
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    const img = wrapper.find('.ambiguous-card img.source-preview')
    expect(img.exists()).toBe(true)
    await img.trigger('click')
    expect(openLightboxSpy).toHaveBeenCalledWith('ambig-sb.png', ['ambig-sb.png'], {})
  })

  it('collapsing an auto-opened ambiguous card closes the preview', async () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-ambig-sb.png', source_files: ['ambig-sb.png'], data: {},
        ambiguous: true, candidates: [{ match_key: 'match:foo', distance_seconds: 720 }] },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig })
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    expect(wrapper.find('.ambiguous-card img.source-preview').exists()).toBe(true)
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    expect(wrapper.find('.ambiguous-card img.source-preview').exists()).toBe(false)
  })

  it('candidate-picker renders a side-by-side preview pane on the first candidate by default', async () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-ambig-sb.png', source_files: ['ambig-sb.png'], data: {}, ambiguous: true,
        candidates: [
          { match_key: 'match:a', distance_seconds: 60, representative_source_file: 'a-sum.png' },
          { match_key: 'match:b', distance_seconds: 120, representative_source_file: 'b-sum.png' },
        ] },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig })
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    const pane = wrapper.find('.candidate-preview-pane')
    expect(pane.exists()).toBe(true)
    expect(pane.find('img').attributes('src')).toContain(encodeURIComponent('a-sum.png'))
    expect(wrapper.find('.candidate-row.active').exists()).toBe(true)
  })

  it('hovering a different candidate updates the preview pane', async () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-ambig-sb.png', source_files: ['ambig-sb.png'], data: {}, ambiguous: true,
        candidates: [
          { match_key: 'match:a', distance_seconds: 60, representative_source_file: 'a-sum.png' },
          { match_key: 'match:b', distance_seconds: 120, representative_source_file: 'b-sum.png' },
        ] },
    ]
    const { wrapper } = mountWith([], { ambiguousRecords: ambig })
    await wrapper.find('.ambiguous-card .unknown-card-head').trigger('click')
    await wrapper.findAll('.candidate-row')[1]!.trigger('mouseenter')
    expect(wrapper.find('.candidate-preview-pane img').attributes('src')).toContain(encodeURIComponent('b-sum.png'))
  })

  // ── Hover thumbnail (Teleport'd to <body>) ──────────────────
  describe('hover thumbnail on collapsed cards', () => {
    function fireMouseenter(wrapper: ReturnType<typeof mountWith>['wrapper']) {
      return wrapper.find('.unknown-card').trigger('mouseenter', { clientX: 200, clientY: 300 })
    }

    it('renders a floating thumbnail with the first source URL on mouseenter', async () => {
      const { wrapper } = mountWith([{ match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} }])
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
      const { wrapper } = mountWith([{ match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} }])
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
      const { wrapper } = mountWith([{ match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} }])
      try {
        await wrapper.find('.unknown-card-head').trigger('click')
        await fireMouseenter(wrapper)
        expect(document.querySelector('.unknown-hover-thumb')).toBeNull()
      } finally {
        wrapper.unmount()
      }
    })

    it('does not render when the record has no source_files', async () => {
      const { wrapper } = mountWith([{ match_key: 'unmatched-empty', source_files: [], data: {} }])
      try {
        await fireMouseenter(wrapper)
        expect(document.querySelector('.unknown-hover-thumb')).toBeNull()
      } finally {
        wrapper.unmount()
      }
    })

    it('uses the first source_file when a record has several', async () => {
      const { wrapper } = mountWith([{ match_key: 'unmatched-multi', source_files: ['first.png', 'second.png'], data: {} }])
      try {
        await fireMouseenter(wrapper)
        expect(document.querySelector<HTMLImageElement>('.unknown-hover-thumb')!.getAttribute('src')).toMatch(/first\.png/)
      } finally {
        wrapper.unmount()
      }
    })

    it('updates position on mousemove inside the hovered card', async () => {
      const { wrapper } = mountWith([{ match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} }])
      try {
        await wrapper.find('.unknown-card').trigger('mouseenter', { clientX: 50, clientY: 80 })
        const thumb = document.querySelector<HTMLElement>('.unknown-hover-thumb')!
        const firstLeft = thumb.style.left
        await wrapper.find('.unknown-card').trigger('mousemove', { clientX: 240, clientY: 380 })
        expect(thumb.style.left).not.toBe(firstLeft)
      } finally {
        wrapper.unmount()
      }
    })
  })

  // ── Preload on mount (warms the HTTP cache via the UI store's preload) ──
  describe('screenshot preload on view mount', () => {
    it('preloads once per record with its first source file URL', () => {
      const { preloadSpy } = mountWith([
        { match_key: 'unmatched-one.png', source_files: ['one.png'], data: {} },
        { match_key: 'unmatched-two.png', source_files: ['two.png', 'twoB.png'], data: {} },
      ])
      const urls = preloadSpy.mock.calls.map(c => c[0])
      expect(urls).toContain('/_screenshot/0/one.png')
      expect(urls).toContain('/_screenshot/0/two.png')
      expect(urls).not.toContain('/_screenshot/0/twoB.png')
    })

    it('skips records with no source_files', () => {
      const { preloadSpy } = mountWith([{ match_key: 'unmatched-empty', source_files: [], data: {} }])
      expect(preloadSpy).not.toHaveBeenCalled()
    })
  })

  describe('reference data gap CTA', () => {
    function gapRecord(opts: { matchKey: string; heroRaw?: string; mapRaw?: string }): MatchRecord {
      return {
        match_key:    opts.matchKey,
        source_files: [`${opts.matchKey}.png`],
        data: { hero_raw: opts.heroRaw, map_raw: opts.mapRaw },
      } as unknown as MatchRecord
    }
    const baseInfo: UpdateInfo = {
      checked: true, dev_build: false, available: true, latest: '1.2.3',
      url: 'https://github.com/sound-barrier/recall/releases/tag/v1.2.3',
      latest_heroes: ['Miyazaki', 'Reinhardt'], latest_maps: ['Hanaoka'],
      game_data: { commit_sha: '', applied_commit: '', has_update: false },
    }

    it('surfaces the CTA when a gap record\'s hero_raw is in the latest roster', () => {
      const { wrapper } = mountWith([], {
        referenceGapRecords: [gapRecord({ matchKey: 'r1', heroRaw: 'miyazaki' })], updateInfo: baseInfo,
      })
      const fix = wrapper.find('[data-fix-cta-key="r1"]')
      expect(fix.exists()).toBe(true)
      expect(fix.text()).toContain('Fixed in')
      expect(fix.text()).toContain('v1.2.3')
      expect(fix.text()).toContain('Miyazaki')
      expect(fix.find('.fix-link').attributes('href')).toBe(baseInfo.url)
    })

    it('surfaces the CTA on a map_raw hit too', () => {
      const { wrapper } = mountWith([], {
        referenceGapRecords: [gapRecord({ matchKey: 'r2', mapRaw: 'hanaoka' })], updateInfo: baseInfo,
      })
      const fix = wrapper.find('[data-fix-cta-key="r2"]')
      expect(fix.exists()).toBe(true)
      expect(fix.text()).toContain('Hanaoka')
    })

    it('does NOT surface the CTA when updateInfo is null (user hasn\'t pulled yet)', () => {
      const { wrapper } = mountWith([], {
        referenceGapRecords: [gapRecord({ matchKey: 'r3', heroRaw: 'miyazaki' })], updateInfo: null,
      })
      expect(wrapper.find('[data-fix-cta-key="r3"]').exists()).toBe(false)
    })

    it('does NOT surface the CTA when the running build is already the latest', () => {
      const { wrapper } = mountWith([], {
        referenceGapRecords: [gapRecord({ matchKey: 'r4', heroRaw: 'miyazaki' })], updateInfo: { ...baseInfo, available: false },
      })
      expect(wrapper.find('[data-fix-cta-key="r4"]').exists()).toBe(false)
    })

    it('does NOT surface the CTA when the upcoming release doesn\'t recognise the name', () => {
      const { wrapper } = mountWith([], {
        referenceGapRecords: [gapRecord({ matchKey: 'r5', heroRaw: 'unknownhero' })], updateInfo: baseInfo,
      })
      expect(wrapper.find('[data-fix-cta-key="r5"]').exists()).toBe(false)
    })

    it('does NOT surface the CTA when the YAML rosters are empty (sidecar verify failed)', () => {
      const { wrapper } = mountWith([], {
        referenceGapRecords: [gapRecord({ matchKey: 'r6', heroRaw: 'miyazaki' })], updateInfo: { ...baseInfo, latest_heroes: [], latest_maps: [] },
      })
      expect(wrapper.find('[data-fix-cta-key="r6"]').exists()).toBe(false)
    })
  })
})

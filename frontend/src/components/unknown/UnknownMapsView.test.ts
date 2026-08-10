import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'

import UnknownMapsView from '@/components/unknown/UnknownMapsView.vue'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'
import { ResolveAmbiguousMatch } from '@/api'
import type { MatchRecord, UpdateInfo } from '@/api'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'

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
// store's preload + openLightbox before render so the view's setup captures them.
function renderWith(records: MatchRecord[], extras: Extras = {}) {
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
  seedQuery(qk.system.update, extras.updateInfo ?? null)
  const ui = useUiStore()
  const preloadSpy = vi.spyOn(ui.preview, 'preload')
  const openLightboxSpy = vi.spyOn(ui.preview, 'openLightbox')
  const view = render(UnknownMapsView, { global: { plugins: [pinia] } })
  return { view, app, ui, preloadSpy, openLightboxSpy }
}

// ── Accessible handles ───────────────────────────────────────────────
// Each triage card is an <article> that names itself after the
// screenshot it is about, so cards + the candidate preview pane are
// reachable by role + name. Interactions use TL fireEvent throughout,
// matching the original trigger() dispatch.
const unknownCards   = () => screen.queryAllByRole('article', { name: /^Unmatched screenshot / })
const ambiguousCards = () => screen.queryAllByRole('article', { name: /^Ambiguous screenshot / })
const unknownCard    = () => unknownCards()[0]!
// The active candidate's preview pane is an <aside> labeled with the
// candidate it is previewing, so "which candidate drives the pane" is a
// role + name lookup.
const previewPaneFor = (key: string) => screen.queryByRole('complementary', { name: `Preview of ${key}` })

// ── Structural helpers ───────────────────────────────────────────────
// The card head is a clickable container (a plain div per the documented
// interaction pattern), the diagnostic strip's filled/vacant state and
// the teleported hover thumb are presentational, and the fix-CTA rows
// carry their e2e-shared data-key identity. None of those surfaces have
// an accessible-name equivalent, so they are selected directly.
/* eslint-disable testing-library/no-node-access -- clickable-container heads, presentational strips, and e2e-shared data-keys have no accessible-query equivalent */
const cardHead       = () => document.querySelector('.unknown-card-head')!
const ambiguousHead  = () => document.querySelector('.ambiguous-card .unknown-card-head')!
const ambiguousPreviewImg = () => document.querySelector('.ambiguous-card img.source-preview')
const sourcePreviewImg    = () => document.querySelector('img.source-preview')
const hoverThumb     = () => document.querySelector<HTMLElement>('.unknown-hover-thumb')
const fieldCells     = (kind: 'filled' | 'vacant') => document.querySelectorAll(`.field-cell.${kind}`)
const candidateRows  = () => document.querySelectorAll('.candidate-row')
const fixCta         = (key: string) => document.querySelector(`[data-fix-cta-key="${key}"]`)
/* eslint-enable testing-library/no-node-access */

describe('UnknownMapsView', () => {
  it('renders the all-resolved state when there are no unknown records', () => {
    renderWith([])
    expect(screen.getByText(/All screenshots resolved\./)).toBeInTheDocument()
    expect(screen.getByText(/No unresolved records\./)).toBeInTheDocument()
    expect(unknownCards()).toHaveLength(0)
  })

  it('renders one card per unknown record with the right match key', () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched-scoreboard1.png', source_files: ['scoreboard1.png'], data: {
        eliminations: 17, assists: 16, deaths: 11, result: 'victory',
      } },
      { match_key: 'unmatched-broken.png', source_files: ['broken.png'], data: {} },
    ]
    renderWith(records)
    expect(unknownCards()).toHaveLength(2)
    expect(screen.getByText('unmatched-scoreboard1.png')).toBeInTheDocument()
    expect(screen.getByText('unmatched-broken.png')).toBeInTheDocument()
    expect(screen.getByText(/need your attention/)).toHaveTextContent(/2 records/)
  })

  it('navigates to the Parse tab when the "run Parse" link is clicked', async () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
    ]
    const { app } = renderWith(records)
    await fireEvent.click(screen.getByRole('button', { name: /parse/i }))
    expect(app.view).toBe('ingest')
  })

  it('clicking the card head expands it (opens the source block)', async () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
    ]
    renderWith(records)
    expect(screen.queryByText('x.png')).not.toBeInTheDocument()
    await fireEvent.click(cardHead())
    expect(screen.getByText('x.png')).toBeInTheDocument()
  })

  it('shows the field diagnostic strip with vacant cells for missing values', () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
    ]
    renderWith(records)
    expect(fieldCells('filled')).toHaveLength(0)
    expect(fieldCells('vacant').length).toBeGreaterThan(0)
  })

  // ─── Ambiguous attribution surface ─────────────────────────

  it('renders the "Needs your review" subheading with the ambiguous count', () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-scoreboard-2.png', source_files: ['scoreboard-2.png'], data: { hero: 'lucio' },
        ambiguous: true, candidates: [{ match_key: 'match:foo', distance_seconds: 720 }] },
    ]
    renderWith([], { ambiguousRecords: ambig })
    expect(screen.getByText(/Needs your review — 1/)).toBeInTheDocument()
    expect(ambiguousCards()).toHaveLength(1)
  })

  it('expanding an ambiguous card surfaces the candidate picker', async () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-scoreboard-2.png', source_files: ['scoreboard-2.png'], data: { hero: 'lucio' },
        ambiguous: true, candidates: [{ match_key: 'match:foo', distance_seconds: 720 }] },
    ]
    const all: MatchRecord[] = [
      { match_key: 'match:foo', source_files: ['sb1.png'], data: { map: 'rialto', hero: 'lucio', date: '2026-05-10' } },
    ]
    renderWith([], { ambiguousRecords: ambig, allRecords: all })
    await fireEvent.click(ambiguousHead())
    expect(candidateRows()).toHaveLength(1)
    expect(screen.getByText(/12 min apart/)).toBeInTheDocument()
    expect(screen.getByText(/rialto/)).toBeInTheDocument()
  })

  it('clicking Attach resolves the ambiguous record to the candidate key', async () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-scoreboard-2.png', source_files: ['scoreboard-2.png'], data: { hero: 'lucio' },
        ambiguous: true, candidates: [{ match_key: 'match:foo', distance_seconds: 720 }] },
    ]
    renderWith([], { ambiguousRecords: ambig })
    await fireEvent.click(ambiguousHead())
    await fireEvent.click(screen.getByRole('button', { name: /Attach to this match/ }))
    expect(ResolveAmbiguousMatch).toHaveBeenCalledWith('ambiguous-scoreboard-2.png', 'match:foo')
  })

  it('"Treat as new match" mints a fresh match-<ts> key from the filename', async () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-Overwatch 2 Screenshot 2026.05.10 - 21.41.28.00_scoreboard.png',
        source_files: ['Overwatch 2 Screenshot 2026.05.10 - 21.41.28.00_scoreboard.png'], data: {},
        ambiguous: true, candidates: [{ match_key: 'match:old', distance_seconds: 720 }] },
    ]
    renderWith([], { ambiguousRecords: ambig })
    await fireEvent.click(ambiguousHead())
    await fireEvent.click(screen.getByRole('button', { name: /Treat as new match/ }))
    expect(ResolveAmbiguousMatch).toHaveBeenCalled()
    expect((ResolveAmbiguousMatch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]).toBe('match-2026-05-10T21-41-28')
  })

  // ─── Screenshot preview → fullscreen lightbox ──────────────

  it('clicking a source-preview thumbnail opens the lightbox via the UI store', async () => {
    const records: MatchRecord[] = [
      { match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} },
    ]
    const { openLightboxSpy } = renderWith(records)
    await fireEvent.click(cardHead())
    await fireEvent.click(screen.getByText('x.png'))
    const img = sourcePreviewImg()
    expect(img).not.toBeNull()
    await fireEvent.click(img!)
    expect(openLightboxSpy).toHaveBeenCalledWith('x.png', ['x.png'], {})
  })

  it('expanding an ambiguous card auto-opens the source-screenshot preview', async () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-ambig-sb.png', source_files: ['ambig-sb.png'], data: {},
        ambiguous: true, candidates: [{ match_key: 'match:foo', distance_seconds: 720 }] },
    ]
    const { openLightboxSpy } = renderWith([], { ambiguousRecords: ambig })
    await fireEvent.click(ambiguousHead())
    const img = ambiguousPreviewImg()
    expect(img).not.toBeNull()
    await fireEvent.click(img!)
    expect(openLightboxSpy).toHaveBeenCalledWith('ambig-sb.png', ['ambig-sb.png'], {})
  })

  it('collapsing an auto-opened ambiguous card closes the preview', async () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-ambig-sb.png', source_files: ['ambig-sb.png'], data: {},
        ambiguous: true, candidates: [{ match_key: 'match:foo', distance_seconds: 720 }] },
    ]
    renderWith([], { ambiguousRecords: ambig })
    await fireEvent.click(ambiguousHead())
    expect(ambiguousPreviewImg()).not.toBeNull()
    await fireEvent.click(ambiguousHead())
    expect(ambiguousPreviewImg()).toBeNull()
  })

  it('candidate-picker renders a side-by-side preview pane on the first candidate by default', async () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-ambig-sb.png', source_files: ['ambig-sb.png'], data: {}, ambiguous: true,
        candidates: [
          { match_key: 'match:a', distance_seconds: 60, representative_source_file: 'a-sum.png' },
          { match_key: 'match:b', distance_seconds: 120, representative_source_file: 'b-sum.png' },
        ] },
    ]
    renderWith([], { ambiguousRecords: ambig })
    await fireEvent.click(ambiguousHead())
    // The pane names the candidate it previews, so its accessible name IS
    // the "first candidate by default" contract.
    expect(previewPaneFor('match:a')).toBeInTheDocument()
    expect(previewPaneFor('match:b')).not.toBeInTheDocument()
    expect(candidateRows()[0]).toHaveAttribute('aria-current', 'true')
    expect(candidateRows()[1]).not.toHaveAttribute('aria-current')
  })

  it('hovering a different candidate updates the preview pane', async () => {
    const ambig: MatchRecord[] = [
      { match_key: 'ambiguous-ambig-sb.png', source_files: ['ambig-sb.png'], data: {}, ambiguous: true,
        candidates: [
          { match_key: 'match:a', distance_seconds: 60, representative_source_file: 'a-sum.png' },
          { match_key: 'match:b', distance_seconds: 120, representative_source_file: 'b-sum.png' },
        ] },
    ]
    renderWith([], { ambiguousRecords: ambig })
    await fireEvent.click(ambiguousHead())
    await fireEvent.mouseEnter(candidateRows()[1]!)
    expect(previewPaneFor('match:b')).toBeInTheDocument()
    expect(candidateRows()[1]).toHaveAttribute('aria-current', 'true')
  })

  // ── Hover thumbnail (Teleport'd to <body>) ──────────────────
  describe('hover thumbnail on collapsed cards', () => {
    function fireMouseenter(coords: { clientX: number; clientY: number } = { clientX: 200, clientY: 300 }) {
      return fireEvent.mouseEnter(unknownCard(), coords)
    }

    it('renders a floating thumbnail with the first source URL on mouseenter', async () => {
      renderWith([{ match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} }])
      expect(hoverThumb()).toBeNull()
      await fireMouseenter()
      const thumb = hoverThumb()
      expect(thumb).not.toBeNull()
      expect(thumb!.getAttribute('src')).toMatch(/_screenshot\/0\/x\.png/)
    })

    it('disappears on mouseleave', async () => {
      renderWith([{ match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} }])
      await fireMouseenter()
      expect(hoverThumb()).not.toBeNull()
      await fireEvent.mouseLeave(unknownCard())
      expect(hoverThumb()).toBeNull()
    })

    it('does not render when the card is already expanded', async () => {
      renderWith([{ match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} }])
      await fireEvent.click(cardHead())
      await fireMouseenter()
      expect(hoverThumb()).toBeNull()
    })

    it('does not render when the record has no source_files', async () => {
      renderWith([{ match_key: 'unmatched-empty', source_files: [], data: {} }])
      await fireMouseenter()
      expect(hoverThumb()).toBeNull()
    })

    it('uses the first source_file when a record has several', async () => {
      renderWith([{ match_key: 'unmatched-multi', source_files: ['first.png', 'second.png'], data: {} }])
      await fireMouseenter()
      expect(hoverThumb()!.getAttribute('src')).toMatch(/first\.png/)
    })

    it('updates position on mousemove inside the hovered card', async () => {
      renderWith([{ match_key: 'unmatched-x.png', source_files: ['x.png'], data: {} }])
      await fireMouseenter({ clientX: 50, clientY: 80 })
      const thumb = hoverThumb()!
      const firstLeft = thumb.style.left
      await fireEvent.mouseMove(unknownCard(), { clientX: 240, clientY: 380 })
      // eslint-disable-next-line no-restricted-syntax -- the cursor-anchored thumb is aria-hidden decoration; its inline offset IS the behavior
      expect(thumb.style.left).not.toBe(firstLeft)
    })
  })

  // ── Preload on mount (warms the HTTP cache via the UI store's preload) ──
  describe('screenshot preload on view mount', () => {
    it('preloads once per record with its first source file URL', () => {
      const { preloadSpy } = renderWith([
        { match_key: 'unmatched-one.png', source_files: ['one.png'], data: {} },
        { match_key: 'unmatched-two.png', source_files: ['two.png', 'twoB.png'], data: {} },
      ])
      const urls = preloadSpy.mock.calls.map(c => c[0])
      expect(urls).toContain('/_screenshot/0/one.png')
      expect(urls).toContain('/_screenshot/0/two.png')
      expect(urls).not.toContain('/_screenshot/0/twoB.png')
    })

    it('skips records with no source_files', () => {
      const { preloadSpy } = renderWith([{ match_key: 'unmatched-empty', source_files: [], data: {} }])
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
      can_self_update: false,
    }

    it('surfaces the CTA when a gap record\'s hero_raw is in the latest roster', () => {
      renderWith([], {
        referenceGapRecords: [gapRecord({ matchKey: 'r1', heroRaw: 'miyazaki' })], updateInfo: baseInfo,
      })
      const fix = fixCta('r1')
      expect(fix).toHaveTextContent('Fixed in')
      expect(fix).toHaveTextContent('v1.2.3')
      expect(fix).toHaveTextContent('Miyazaki')
      expect(within(fix as HTMLElement).getByRole('link')).toHaveAttribute('href', baseInfo.url)
    })

    it('surfaces the CTA on a map_raw hit too', () => {
      renderWith([], {
        referenceGapRecords: [gapRecord({ matchKey: 'r2', mapRaw: 'hanaoka' })], updateInfo: baseInfo,
      })
      expect(fixCta('r2')).toHaveTextContent('Hanaoka')
    })

    it('does NOT surface the CTA when updateInfo is null (user hasn\'t pulled yet)', () => {
      renderWith([], {
        referenceGapRecords: [gapRecord({ matchKey: 'r3', heroRaw: 'miyazaki' })], updateInfo: null,
      })
      expect(fixCta('r3')).toBeNull()
    })

    it('does NOT surface the CTA when the running build is already the latest', () => {
      renderWith([], {
        referenceGapRecords: [gapRecord({ matchKey: 'r4', heroRaw: 'miyazaki' })], updateInfo: { ...baseInfo, available: false },
      })
      expect(fixCta('r4')).toBeNull()
    })

    it('does NOT surface the CTA when the upcoming release doesn\'t recognize the name', () => {
      renderWith([], {
        referenceGapRecords: [gapRecord({ matchKey: 'r5', heroRaw: 'unknownhero' })], updateInfo: baseInfo,
      })
      expect(fixCta('r5')).toBeNull()
    })

    it('does NOT surface the CTA when the YAML rosters are empty (sidecar verify failed)', () => {
      renderWith([], {
        referenceGapRecords: [gapRecord({ matchKey: 'r6', heroRaw: 'miyazaki' })], updateInfo: { ...baseInfo, latest_heroes: [], latest_maps: [] },
      })
      expect(fixCta('r6')).toBeNull()
    })
  })
})

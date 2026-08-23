import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import { fireEvent, render, screen } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'

import { useUiStore } from '@/stores/ui'

import MatchesDossierHead from '@/components/matches/dossier/MatchesDossierHead.vue'
import {
  createMatchesNarrowState,
  useMatchesNarrow,
} from '@/composables/matches/narrow/useMatchesNarrow'
import {
  LAYOUT_STORAGE_KEY,
  LAYOUT_VERSION_KEY,
  CURRENT_LAYOUT_VERSION,
  _resetDashboardLayoutForTest,
} from '@/composables/dashboard/useDashboardLayout'
import { _resetSectionLayoutForTest } from '@/composables/matches/dossier/useSectionLayout'
import type { MatchRecord } from '@/api-client'
import type { NarrowMode } from '@/composables/matches/narrow/useNarrowMode'

// MatchesDossierHead owns the SET SUMMARY the whole Matches view is read
// through — the headline that names the active narrow in words, the
// "n of m" subline, the anchor chip label, plus the date-only "Reset
// filter" escape hatch and the popover trigger. Each is a formatting or
// scoping rule that silently lies to the user when it drifts.
//
// The widget grid below the summary is seeded EMPTY (an empty persisted
// layout) so these tests stay about the summary; the grid's own drag /
// undo / config machinery is covered by useDashboardGrid's suite.

type Narrow = ReturnType<typeof useMatchesNarrow>

// happy-dom's localStorage is a no-op, so useDashboardLayout /
// useSectionLayout would never see the seed. Mirrors renderWidget's shim.
function installLocalStorageShim(): void {
  const storage: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem:    (k: string) => storage[k] ?? null,
    setItem:    (k: string, v: string) => { storage[k] = String(v) },
    removeItem: (k: string) => { delete storage[k] },
    clear:      () => { for (const k of Object.keys(storage)) delete storage[k] },
    key:        (i: number) => Object.keys(storage)[i] ?? null,
    get length() { return Object.keys(storage).length },
  })
}

beforeEach(() => {
  // The narrow panel's open-state lives in the ui store now: one flag, so
  // setNarrowOpen actually opens the panel instead of the shell having to
  // click the trigger button by its CSS class.
  setActivePinia(createPinia())
  installLocalStorageShim()
  localStorage.setItem(LAYOUT_VERSION_KEY, String(CURRENT_LAYOUT_VERSION))
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ 1: [], 2: [] }))
  _resetDashboardLayoutForTest()
  _resetSectionLayoutForTest()
})

afterEach(async () => {
  // The head lazy-imports NarrowPopover; a loader resolving after teardown
  // throws EnvironmentTeardownError and fails an otherwise-green run.
  await vi.dynamicImportSettled()
  vi.unstubAllGlobals()
})

function record(key: string, over: Partial<MatchRecord['data']> = {}): MatchRecord {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: { map: 'rialto', result: 'victory', date: '2026-05-10', ...over },
  }
}

interface SetupOptions {
  records?: MatchRecord[]
  anchorKey?: string
  narrowMode?: NarrowMode
}

function setup(seed: (narrow: Narrow) => void = () => {}, opts: SetupOptions = {}) {
  const records = opts.records ?? []
  const recordsRef = ref<MatchRecord[]>(records)
  const anchorKey = computed(() => opts.anchorKey ?? '')
  const narrow = useMatchesNarrow(recordsRef, createMatchesNarrowState({ anchorKey }))
  seed(narrow)
  const view = render(MatchesDossierHead, {
    props: { narrow, records, narrowMode: opts.narrowMode ?? 'popover' },
  })
  return { narrow, view }
}

const headline = () => screen.getByRole('heading', { level: 2 }).textContent?.trim() ?? ''

describe('MatchesDossierHead — set headline', () => {
  it('names the unfiltered corpus and says the set spans everything', () => {
    setup(() => {}, { records: [record('k1')] })
    expect(headline()).toBe('All matches on record')
    expect(screen.getByText('spans your full history')).toBeInTheDocument()
  })

  it('spells every clause into the headline in display order', () => {
    setup((n) => {
      n.searchText.value = '  ana  '
      n.customFrom.value = '2026-05-01'
      n.customTo.value = '2026-05-31'
      n.pickedSeason.value = 'Season 15'
      n.pickGameMode('control')
      n.pickGameMode('push')
      n.pickMap('rialto')
      n.pickMap('havana')
      n.pickRole('support')
      n.pickHero('lucio')
      n.pickHero('ana')
      n.pickResult('victory')
      n.pickTag('smurf')
      n.pickTag('tilt')
      n.pickMember('jax')
    })
    expect(headline()).toBe(
      '"ana" — 2026-05-01 → 2026-05-31 — Season 15 — control/push — rialto · havana'
      + ' — support — lucio · ana — victory — #smurf #tilt — with jax',
    )
  })

  it('lets an explicit custom range win over the preset range', () => {
    setup((n) => {
      n.pickedRange.value = '30d'
      n.customFrom.value = '2026-05-01'
      n.customFromTime.value = '18:00'
    })
    expect(headline()).toBe('2026-05-01 18:00 → …')
  })

  it('falls back to the preset wording when no custom bound is set', () => {
    setup((n) => { n.pickedRange.value = '90d' })
    expect(headline()).toBe('last 90d')
  })

  it('falls back to "Active narrow" for a clause with no words of its own', () => {
    // includeUnknown narrows the set but contributes no headline part —
    // without the fallback the headline would render empty.
    setup((n) => { n.includeUnknown.value = true })
    expect(headline()).toBe('Active narrow')
  })
})

describe('MatchesDossierHead — set subline', () => {
  it('counts the narrowed rows against the full corpus', () => {
    setup((n) => { n.pickResult('victory') }, {
      records: [
        record('k1', { result: 'victory' }),
        record('k2', { result: 'defeat' }),
        record('k3', { result: 'victory' }),
      ],
    })
    expect(screen.getByText('2 of 3 matches in this view')).toBeInTheDocument()
  })

  it('reports zero rather than hiding an over-narrowed set', () => {
    setup((n) => { n.pickMap('kings-row') }, { records: [record('k1'), record('k2')] })
    expect(screen.getByText('0 of 2 matches in this view')).toBeInTheDocument()
  })
})

describe('MatchesDossierHead — anchor chip label', () => {
  it('labels the Since chip with the anchored match\'s date and map', () => {
    setup((n) => { n.sinceAnchorActive.value = true }, {
      records: [record('k1'), record('anchor-1', { date: '2026-04-02', map: 'havana' })],
      anchorKey: 'anchor-1',
    })
    expect(screen.getByText('2026-04-02 · havana')).toBeInTheDocument()
  })

  it('falls back to the map alone when the anchored match has no date', () => {
    setup((n) => { n.sinceAnchorActive.value = true }, {
      records: [record('anchor-1', { date: undefined, map: 'havana' })],
      anchorKey: 'anchor-1',
    })
    expect(screen.getByText('havana')).toBeInTheDocument()
  })

  it('dashes the map out for an anchored match the parser never mapped', () => {
    setup((n) => { n.sinceAnchorActive.value = true }, {
      records: [record('anchor-1', { date: undefined, map: undefined })],
      anchorKey: 'anchor-1',
    })
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('drops the chip entirely when the anchor points at a deleted match', () => {
    setup((n) => {
      n.sinceAnchorActive.value = true
      n.pickMap('rialto')
    }, { records: [record('k1')], anchorKey: 'anchor-gone' })
    expect(screen.getByRole('button', { name: 'Drop map rialto' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop filtering since anchor' })).not.toBeInTheDocument()
  })
})

describe('MatchesDossierHead — Reset filter (date scope only)', () => {
  const resetBtn = () => screen.queryByRole('button', { name: 'Reset filter' })

  it('stays hidden while no date range is picked', () => {
    setup((n) => { n.pickMap('rialto') })
    expect(resetBtn()).not.toBeInTheDocument()
  })

  it('appears for a custom bound and for a preset alike', async () => {
    const { narrow } = setup((n) => { n.customTo.value = '2026-05-31' })
    expect(resetBtn()).toBeInTheDocument()

    narrow.customTo.value = ''
    narrow.pickedRange.value = '7d'
    await nextTick()
    expect(resetBtn()).toBeInTheDocument()
  })

  it('clears ONLY the date clause — every other pick survives', async () => {
    const { narrow } = setup((n) => {
      n.customFrom.value = '2026-05-01'
      n.customFromTime.value = '18:00'
      n.customTo.value = '2026-05-31'
      n.pickedRange.value = 'custom'
      n.searchText.value = 'ana'
      n.pickMap('rialto')
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Reset filter' }))

    expect(narrow.pickedRange.value).toBe('all')
    expect(narrow.customFrom.value).toBe('')
    expect(narrow.customFromTime.value).toBe('')
    expect(narrow.customTo.value).toBe('')
    expect(narrow.searchText.value).toBe('ana')
    expect(narrow.pickedMaps.value.has('rialto')).toBe(true)
    expect(resetBtn()).not.toBeInTheDocument()
  })
})

describe('MatchesDossierHead — narrow trigger', () => {
  const trigger = () => screen.queryByRole('button', { name: /^Filter matches/ })

  it('carries the live clause count and toggles aria-expanded', async () => {
    setup((n) => {
      n.pickMap('rialto')
      n.pickHero('lucio')
    })
    const btn = screen.getByRole('button', { name: 'Filter matches · 2' })
    expect(btn).toHaveAttribute('aria-expanded', 'false')

    await fireEvent.click(btn)
    expect(screen.getByRole('button', { name: 'Filter matches · 2' })).toHaveAttribute('aria-expanded', 'true')
  })

  // The shell freezes the background while the panel is up, and reads one
  // flag to know. That flag used to be mirrored from a local ref through an
  // emit relay, which meant the store's copy could not OPEN anything — so
  // three other features clicked this button by its CSS class instead.
  it('puts the open panel in the ui store, which is what freezes the background', async () => {
    setup()
    await vi.dynamicImportSettled()
    await nextTick()

    const ui = useUiStore()
    expect(ui.narrowOpen).toBe(false)

    await fireEvent.click(screen.getByRole('button', { name: 'Filter matches' }))
    expect(ui.narrowOpen).toBe(true)
  })

  // The other half of one flag: writing it opens the panel, so a caller does
  // not have to reach for the trigger's markup to do it.
  it('opens the panel when the store flag is set from elsewhere', async () => {
    setup()
    await vi.dynamicImportSettled()
    await nextTick()

    useUiStore().setNarrowOpen(true)
    await nextTick()

    expect(screen.getByRole('button', { name: 'Filter matches' }))
      .toHaveAttribute('aria-expanded', 'true')
  })

  it('drops the count suffix when nothing is narrowed', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Filter matches' })).toBeInTheDocument()
  })

  it('is absent in rail mode — the always-open column replaces it', () => {
    setup(() => {}, { narrowMode: 'rail' })
    expect(trigger()).not.toBeInTheDocument()
  })
})

describe('MatchesDossierHead — Add menu', () => {
  it('opens the re-add dialog and reports it through aria-expanded', async () => {
    setup()
    const add = screen.getByRole('button', { name: 'Add' })
    expect(add).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog', { name: 'Add to dossier' })).not.toBeInTheDocument()

    await fireEvent.click(add)

    expect(screen.getByRole('button', { name: 'Add' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: 'Add to dossier' })).toBeInTheDocument()
  })

  it('Escape closes it again and the trigger stops advertising it as open', async () => {
    setup()
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Add to dossier' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toHaveAttribute('aria-expanded', 'false')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import type { NamedCandidate, NamedCandidateStats } from '@/api'
import { setApiBacking } from '@/api-client'
import { activeCalloutId } from '@/composables/onboarding/useContextualCallout'
import ScreenshotSourcePicker from '@/components/settings/ScreenshotSourcePicker.vue'

function mk(over: Partial<NamedCandidate>): NamedCandidate {
  return {
    name:   'nvidia',
    label:  'Nvidia Overlay',
    path:   'C:\\Users\\Jacob\\Videos\\Overwatch',
    exists: true,
    ...over,
  }
}

const fourCards: NamedCandidate[] = [
  mk({ name: 'nvidia',  label: 'Nvidia Overlay', path: 'C:\\Users\\J\\Videos\\Overwatch',          exists: true  }),
  mk({ name: 'prntscn', label: 'OW default',     path: 'C:\\Users\\J\\Documents\\Overwatch\\SS\\Overwatch', exists: false }),
  mk({ name: 'snip',    label: 'Snip tool',      path: 'C:\\Users\\J\\Pictures\\Screenshots',      exists: true  }),
  mk({ name: 'steam',   label: 'Steam install',  path: '', exists: false }),
]

const grid = () => screen.queryByLabelText('Auto-detected screenshot sources')
const customTile = () => screen.getByRole('button', { name: /Pick a different folder/ })

describe('ScreenshotSourcePicker', () => {
  it('renders the 2 × 2 grid + four cards on Windows', () => {
    render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    expect(grid()).toBeInTheDocument()
    expect(within(grid()!).getAllByRole('button')).toHaveLength(4)
  })

  it('emits pick(name, path) when a found card is clicked', async () => {
    const user = userEvent.setup()
    const { emitted } = render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    await user.click(screen.getByRole('button', { name: /Nvidia Overlay/ }))
    expect(emitted('pick')[0]).toEqual(['nvidia', 'C:\\Users\\J\\Videos\\Overwatch'])
  })

  it('does not emit pick when a missing card is clicked', async () => {
    const user = userEvent.setup()
    const { emitted } = render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    await user.click(screen.getByRole('button', { name: /OW default/ }))
    expect(emitted('pick')).toBeUndefined()
  })

  it('marks missing cards as aria-disabled', () => {
    render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    const missing = screen.getByRole('button', { name: /OW default/ })
    expect(missing).toHaveAttribute('aria-disabled', 'true')
    expect(missing).toBeDisabled()
  })

  it('emits pick-custom when the custom-pick tile is clicked', async () => {
    const user = userEvent.setup()
    const { emitted } = render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    await user.click(customTile())
    expect(emitted('pick-custom')).toBeTruthy()
  })

  it('hides the grid on macOS and shows the platform note', () => {
    render(ScreenshotSourcePicker, {
      props: { platform: 'darwin', candidates: [] },
    })
    expect(grid()).not.toBeInTheDocument()
    expect(screen.getByText(/WINDOWS ONLY/)).toBeInTheDocument()
    // Pick-custom tile is still rendered so the Mac user can pick
    // their folder manually.
    expect(customTile()).toBeInTheDocument()
  })

  it('hides the grid on Linux and shows the platform note', () => {
    render(ScreenshotSourcePicker, {
      props: { platform: 'linux', candidates: [] },
    })
    expect(grid()).not.toBeInTheDocument()
    expect(screen.getByText(/WINDOWS ONLY/)).toBeInTheDocument()
  })

  it('disables every interactive element while picking', () => {
    render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards, picking: true },
    })
    expect(screen.getByRole('button', { name: /Nvidia Overlay/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Opening picker/ })).toBeDisabled()
  })
})

// The second metadata line is the whole point of the deferred stats
// fetch: it's how a user tells "this is the folder my captures land in"
// from "this folder exists but Overwatch never wrote to it". Each shape
// below encodes a different verdict.
describe('ScreenshotSourcePicker — per-source diagnostics', () => {
  function isoMinutesAgo(minutes: number): string {
    return new Date(Date.now() - minutes * 60_000).toISOString()
  }

  function stats(over: Partial<NamedCandidateStats> & { name: string }): NamedCandidateStats {
    return { file_count: 0, last_modified: '', recognized_count: 0, ...over }
  }

  function seedStats(list: NamedCandidateStats[]) {
    setApiBacking({ GetScreenshotsFolderCandidateStats: vi.fn(async () => list) })
  }

  const namedCards = (names: NamedCandidate['name'][]): NamedCandidate[] =>
    names.map((name, i) => mk({ name, label: `Source ${i}`, path: `C:\\${name}`, exists: true }))

  afterEach(() => { setApiBacking({}) })

  it('ages each source and hides the recognized subset when everything matched', async () => {
    seedStats([
      stats({ name: 'nvidia',  file_count: 47, recognized_count: 47, last_modified: isoMinutesAgo(0) }),
      stats({ name: 'prntscn', file_count: 12, recognized_count: 12, last_modified: isoMinutesAgo(30) }),
      stats({ name: 'snip',    file_count: 3,  recognized_count: 3,  last_modified: isoMinutesAgo(5 * 60) }),
      stats({ name: 'steam',   file_count: 9,  recognized_count: 9,  last_modified: isoMinutesAgo(3 * 24 * 60) }),
    ])
    render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: namedCards(['nvidia', 'prntscn', 'snip', 'steam']) },
    })

    expect(await screen.findByText('47 files · just now')).toBeInTheDocument()
    expect(screen.getByText('12 files · 30m ago')).toBeInTheDocument()
    expect(screen.getByText('3 files · 5h ago')).toBeInTheDocument()
    expect(screen.getByText('9 files · 3d ago')).toBeInTheDocument()
  })

  it('calls out a folder whose files are not Overwatch captures', async () => {
    seedStats([stats({ name: 'snip', file_count: 12, recognized_count: 0, last_modified: isoMinutesAgo(90) })])
    render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: namedCards(['snip']) },
    })

    expect(await screen.findByText('12 files · 1h ago · 0 recognized')).toBeInTheDocument()
  })

  it('reports an empty folder without an age or a recognized count', async () => {
    seedStats([stats({ name: 'steam', file_count: 0, recognized_count: 0, last_modified: '' })])
    render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: namedCards(['steam']) },
    })

    expect(await screen.findByText('0 files')).toBeInTheDocument()
  })

  it('falls back to a calendar date once the folder is more than a week stale', async () => {
    seedStats([stats({ name: 'nvidia', file_count: 5, recognized_count: 5, last_modified: '2026-01-04T09:15:00Z' })])
    render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: namedCards(['nvidia']) },
    })

    expect(await screen.findByText('5 files · 2026-01-04')).toBeInTheDocument()
  })

  it('drops the age when the timestamp is unreadable rather than printing NaN', async () => {
    seedStats([stats({ name: 'nvidia', file_count: 5, recognized_count: 5, last_modified: 'not-a-date' })])
    render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: namedCards(['nvidia']) },
    })

    expect(await screen.findByText('5 files')).toBeInTheDocument()
  })

  it('renders no diagnostic line for a source the stats call never covered', async () => {
    // Enrichment only — a source missing from the response (or a failed
    // fetch) must leave the card intact, not blank or error out.
    seedStats([stats({ name: 'nvidia', file_count: 5, recognized_count: 5, last_modified: isoMinutesAgo(0) })])
    render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: namedCards(['nvidia', 'steam']) },
    })

    await screen.findByText('5 files · just now')
    expect(screen.getByRole('button', { name: /Source 1/ })).toBeInTheDocument()
    expect(screen.getAllByText(/\d+ files/)).toHaveLength(1)
  })
})

// The four card labels don't say that each maps to a specific capture
// pipeline, so a one-shot callout explains it. It must fire exactly
// where the grid does — and never twice on the same device.
describe('ScreenshotSourcePicker — first-run hint', () => {
  const HINT = 'Each card is one capture tool'
  const SEEN_KEY = 'recall.tour.source-picker.seen'
  const memStore = new Map<string, string>()

  beforeEach(() => {
    memStore.clear()
    activeCalloutId.value = null
    // happy-dom ships no localStorage, and the callout treats an
    // unavailable store as "already seen" — without a stand-in these
    // cases would be vacuous.
    vi.stubGlobal('localStorage', {
      getItem:    (k: string) => memStore.get(k) ?? null,
      setItem:    (k: string, v: string) => { memStore.set(k, String(v)) },
      removeItem: (k: string) => { memStore.delete(k) },
      clear:      () => { memStore.clear() },
      key:        (i: number) => [...memStore.keys()][i] ?? null,
      get length() { return memStore.size },
    })
  })

  afterEach(() => {
    activeCalloutId.value = null
    vi.unstubAllGlobals()
  })

  it('explains the grid on first sight and retires itself once a card is picked', async () => {
    const user = userEvent.setup()
    render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })

    expect(await screen.findByRole('dialog', { name: HINT })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Nvidia Overlay/ }))

    expect(screen.queryByRole('dialog', { name: HINT })).not.toBeInTheDocument()
    expect(memStore.get(SEEN_KEY)).toBe('true')
  })

  // Acknowledging the hint retires it for good without committing a
  // folder — true of the inline CTA and the close glyph alike.
  it.each(['Got it', 'Dismiss this hint'])('retires on "%s" without picking a source', async (label) => {
    const user = userEvent.setup()
    const { emitted } = render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    await screen.findByRole('dialog', { name: HINT })

    await user.click(screen.getByRole('button', { name: label }))

    expect(screen.queryByRole('dialog', { name: HINT })).not.toBeInTheDocument()
    expect(memStore.get(SEEN_KEY)).toBe('true')
    expect(emitted('pick')).toBeUndefined()
  })

  it('stays away on a platform that has no grid to explain', () => {
    render(ScreenshotSourcePicker, {
      props: { platform: 'darwin', candidates: [] },
    })
    expect(screen.queryByRole('dialog', { name: HINT })).not.toBeInTheDocument()
  })

  it('never re-fires on a device that already dismissed it', () => {
    memStore.set(SEEN_KEY, 'true')
    render(ScreenshotSourcePicker, {
      props: { platform: 'windows', candidates: fourCards },
    })
    expect(screen.queryByRole('dialog', { name: HINT })).not.toBeInTheDocument()
  })
})

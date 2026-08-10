import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import ParseStatusBar from '@/components/ingest/ParseStatusBar.vue'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import type { ParseProgressEvent } from '@/components/ingest/parse-progress'

// ParseStatusBar is the persistent footer that shows "ingesting N of M" across
// every tab. It reads the parse lifecycle from the matches store now, so these
// seed the store + assert the render / visibility state machine + the
// click-to-jump (app store view) and ABORT (matches-store action) gestures.
// App.test.ts covers the full integration.
//
// The bar is role="status" and goes aria-hidden+inert while dormant, so
// its whole visibility state machine reads through the role query:
// present ⇔ visible-to-AT.

const evt = (over: Partial<ParseProgressEvent> = {}): ParseProgressEvent => ({
  done: 0,
  total: 0,
  filename: '',
  screenshot_type: '',
  ...over,
})

function renderBar(over: { parseProgress?: ParseProgressEvent | null; cancelingParse?: boolean } = {}) {
  // happy-dom's localStorage is a no-op; without a real store the
  // first-run modal defaults OPEN, freezing the background and forcing
  // the bar aria-hidden even mid-parse. Seed the first-run key the way
  // renderApp does so the bar's own visibility contract is what renders.
  const storage: Record<string, string> = { 'recall.firstRunAccountNamed': 'true' }
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = String(v) },
    removeItem: (k: string) => { delete storage[k] },
    clear: () => { for (const k of Object.keys(storage)) delete storage[k] },
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  const appStore = useAppStore()
  const matchesStore = useMatchesStore()
  matchesStore.parseProgress = over.parseProgress ?? null
  matchesStore.cancelingParse = over.cancelingParse ?? false
  // Spy before render — the component destructures onCancelParse at setup.
  const cancelSpy = vi.spyOn(matchesStore, 'onCancelParse').mockResolvedValue(undefined)
  const view = render(ParseStatusBar, { global: { plugins: [pinia] } })
  return { view, appStore, matchesStore, cancelSpy }
}

const bar = () => screen.queryByRole('status')
const user = () => userEvent.setup()

describe('ParseStatusBar', () => {
  it('is hidden when no parse is in flight and no grace timer is armed', () => {
    renderBar({ parseProgress: null })
    expect(bar()).not.toBeInTheDocument()
  })

  it('renders the counter, type tag, and filename when a parse is in flight', () => {
    renderBar({
      parseProgress: evt({
        done: 3,
        total: 12,
        filename: 'Overwatch 2 Screenshot 2026.05.24 - 22.36.31.03.png',
        screenshot_type: 'teams',
      }),
    })
    expect(bar()).toBeInTheDocument()
    // Counter is split into done/slash/total spans so font baseline is stable.
    expect(screen.getByText('03')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('teams')).toBeInTheDocument()
    expect(screen.getByText(/22\.36\.31\.03\.png/)).toBeInTheDocument()
  })

  it('reports progress through the progressbar value attributes', () => {
    renderBar({ parseProgress: evt({ done: 5, total: 20, filename: 'x.png' }) })
    const meter = screen.getByRole('progressbar', { name: 'Parse progress' })
    expect(meter).toHaveAttribute('aria-valuemin', '0')
    expect(meter).toHaveAttribute('aria-valuemax', '20')
    expect(meter).toHaveAttribute('aria-valuenow', '5')
  })

  it('jumps to the Parse tab when the bar is clicked', async () => {
    const { appStore } = renderBar({ parseProgress: evt({ done: 1, total: 4, filename: 'a.png' }) })
    await user().click(bar()!)
    expect(appStore.view).toBe('ingest')
  })

  it('stays visible for a 1.5s grace period after the parse completes', async () => {
    vi.useFakeTimers()
    try {
      const { matchesStore } = renderBar({ parseProgress: evt({ done: 1, total: 3, filename: 'a.png' }) })
      // Mid-parse → visible.
      expect(bar()).toBeInTheDocument()

      // Bump to done === total → bar should remain visible during grace.
      matchesStore.parseProgress = evt({ done: 3, total: 3, filename: 'a.png' })
      await nextTick()
      expect(bar()).toBeInTheDocument()

      // Advance 1500ms grace + a tick → bar hides.
      vi.advanceTimersByTime(1501)
      await nextTick()
      expect(bar()).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('inerts the bar when hidden so keyboard focus skips it', () => {
    const { view } = renderBar({ parseProgress: null })
    // The dormant bar is aria-hidden by design, so it is invisible to
    // the role query — reach for the element to pin the inert contract.
    // eslint-disable-next-line testing-library/no-node-access -- the aria-hidden+inert dormant state IS the contract under test
    const el = view.baseElement.querySelector('.status-bar')
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el).toHaveAttribute('inert')
  })
})

describe('ParseStatusBar — ABORT tile (item 15 extension)', () => {
  it('renders the ABORT button while a parse is in flight', () => {
    renderBar({ parseProgress: evt({ done: 1, total: 5, filename: 'a.png' }) })
    const btn = screen.getByRole('button', { name: 'Abort parse' })
    expect(btn).toHaveTextContent('ABORT')
    expect(btn).toBeEnabled()
  })

  it('does NOT render the ABORT button when no parse is in flight', () => {
    renderBar({ parseProgress: null })
    expect(screen.queryByRole('button', { name: /Abort/ })).not.toBeInTheDocument()
  })

  it('flips to "ABORTING" + disables itself when cancelingParse is true', () => {
    renderBar({ parseProgress: evt({ done: 1, total: 5, filename: 'a.png' }), cancelingParse: true })
    const btn = screen.getByRole('button', { name: 'Aborting parse' })
    expect(btn).toHaveTextContent('ABORTING')
    expect(btn).toBeDisabled()
  })

  it('click on ABORT cancels the parse and does NOT jump to Parse', async () => {
    const { appStore, cancelSpy } = renderBar({ parseProgress: evt({ done: 1, total: 5, filename: 'a.png' }) })
    await user().click(screen.getByRole('button', { name: 'Abort parse' }))
    expect(cancelSpy).toHaveBeenCalledOnce()
    // The bar's outer click handler must NOT fire (data-no-jump + @click.stop)
    // so the user isn't yanked to Parse at the same moment they hit Abort.
    expect(appStore.view).not.toBe('ingest')
  })

  it('clicking elsewhere on the bar still jumps to Parse (regression guard)', async () => {
    const { appStore } = renderBar({ parseProgress: evt({ done: 1, total: 5, filename: 'a.png' }) })
    await user().click(screen.getByText('01'))
    expect(appStore.view).toBe('ingest')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
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

const evt = (over: Partial<ParseProgressEvent> = {}): ParseProgressEvent => ({
  done: 0,
  total: 0,
  filename: '',
  ...over,
})

function mountBar(over: { parseProgress?: ParseProgressEvent | null; cancellingParse?: boolean } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const appStore = useAppStore()
  const matchesStore = useMatchesStore()
  matchesStore.parseProgress = over.parseProgress ?? null
  matchesStore.cancellingParse = over.cancellingParse ?? false
  // Spy before mount — the component destructures onCancelParse at setup.
  const cancelSpy = vi.spyOn(matchesStore, 'onCancelParse').mockResolvedValue(undefined)
  const w = mount(ParseStatusBar, { global: { plugins: [pinia] } })
  return { w, appStore, matchesStore, cancelSpy }
}

describe('ParseStatusBar', () => {
  it('is hidden when no parse is in flight and no grace timer is armed', () => {
    const { w } = mountBar({ parseProgress: null })
    expect(w.find('.status-bar').classes()).toContain('status-bar-hidden')
  })

  it('renders the counter, type tag, and filename when a parse is in flight', () => {
    const { w } = mountBar({
      parseProgress: evt({
        done: 3,
        total: 12,
        filename: 'Overwatch 2 Screenshot 2026.05.24 - 22.36.31.03.png',
        screenshot_type: 'teams',
      }),
    })
    const bar = w.find('.status-bar')
    expect(bar.classes()).not.toContain('status-bar-hidden')
    // Counter is split into done/slash/total spans so font baseline is stable.
    expect(w.find('.counter-done').text()).toBe('03')
    expect(w.find('.counter-total').text()).toBe('12')
    expect(w.find('.type-tag').text()).toBe('teams')
    expect(w.find('.filename').text()).toContain('22.36.31.03.png')
  })

  it('fills the right number of segmented ticks proportionally', () => {
    const { w } = mountBar({ parseProgress: evt({ done: 5, total: 20, filename: 'x.png' }) })
    const ticks = w.findAll('.tick')
    expect(ticks.length).toBe(20)
    // 5/20 → 5 filled ticks (straight Math.round in the component).
    expect(ticks.filter(t => t.classes().includes('tick-filled')).length).toBe(5)
  })

  it('jumps to the Parse tab when the bar is clicked', async () => {
    const { w, appStore } = mountBar({ parseProgress: evt({ done: 1, total: 4, filename: 'a.png' }) })
    await w.find('.status-bar').trigger('click')
    expect(appStore.view).toBe('ingest')
  })

  it('stays visible for a 1.5s grace period after the parse completes', async () => {
    vi.useFakeTimers()
    try {
      const { w, matchesStore } = mountBar({ parseProgress: evt({ done: 1, total: 3, filename: 'a.png' }) })
      // Mid-parse → visible.
      expect(w.find('.status-bar').classes()).not.toContain('status-bar-hidden')

      // Bump to done === total → bar should remain visible during grace.
      matchesStore.parseProgress = evt({ done: 3, total: 3, filename: 'a.png' })
      await w.vm.$nextTick()
      expect(w.find('.status-bar').classes()).not.toContain('status-bar-hidden')

      // Advance 1500ms grace + a tick → bar hides.
      vi.advanceTimersByTime(1501)
      await w.vm.$nextTick()
      expect(w.find('.status-bar').classes()).toContain('status-bar-hidden')
    } finally {
      vi.useRealTimers()
    }
  })

  it('inerts the bar when hidden so keyboard focus skips it', () => {
    const { w } = mountBar({ parseProgress: null })
    const bar = w.find('.status-bar')
    expect(bar.attributes('aria-hidden')).toBe('true')
    expect(bar.attributes('inert')).toBe('')
  })
})

describe('ParseStatusBar — ABORT tile (item 15 extension)', () => {
  it('renders the ABORT button while a parse is in flight', () => {
    const { w } = mountBar({ parseProgress: evt({ done: 1, total: 5, filename: 'a.png' }) })
    const btn = w.find('[data-testid="status-bar-cancel-btn"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('ABORT')
    expect(btn.attributes('aria-label')).toBe('Abort parse')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('does NOT render the ABORT button when no parse is in flight', () => {
    const { w } = mountBar({ parseProgress: null })
    expect(w.find('[data-testid="status-bar-cancel-btn"]').exists()).toBe(false)
  })

  it('flips to "ABORTING" + disables itself when cancellingParse is true', () => {
    const { w } = mountBar({ parseProgress: evt({ done: 1, total: 5, filename: 'a.png' }), cancellingParse: true })
    const btn = w.find('[data-testid="status-bar-cancel-btn"]')
    expect(btn.text()).toContain('ABORTING')
    expect(btn.attributes('aria-label')).toBe('Aborting parse')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('click on ABORT cancels the parse and does NOT jump to Parse', async () => {
    const { w, appStore, cancelSpy } = mountBar({ parseProgress: evt({ done: 1, total: 5, filename: 'a.png' }) })
    await w.find('[data-testid="status-bar-cancel-btn"]').trigger('click')
    expect(cancelSpy).toHaveBeenCalledOnce()
    // The bar's outer click handler must NOT fire (data-no-jump + @click.stop)
    // so the user isn't yanked to Parse at the same moment they hit Abort.
    expect(appStore.view).not.toBe('ingest')
  })

  it('clicking elsewhere on the bar still jumps to Parse (regression guard)', async () => {
    const { w, appStore } = mountBar({ parseProgress: evt({ done: 1, total: 5, filename: 'a.png' }) })
    await w.find('.counter').trigger('click')
    expect(appStore.view).toBe('ingest')
  })
})

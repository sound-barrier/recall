import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ParseStatusBar from './ParseStatusBar.vue'
import type { ParseProgressEvent } from './ParseProgressPanel.vue'

// ParseStatusBar is the persistent footer that shows "ingesting N of M"
// across every tab. These tests cover the contract — render shape,
// visibility transitions, click-to-jump emit — without exercising the
// full App.vue wiring (App.test.ts covers integration).

const evt = (over: Partial<ParseProgressEvent> = {}): ParseProgressEvent => ({
  done: 0,
  total: 0,
  filename: '',
  ...over,
})

describe('ParseStatusBar', () => {
  it('is hidden when no parse is in flight and no grace timer is armed', () => {
    const w = mount(ParseStatusBar, {
      props: { parseProgress: null, parseLog: [] },
    })
    expect(w.find('.status-bar').classes()).toContain('status-bar-hidden')
  })

  it('renders the counter, type tag, and filename when a parse is in flight', () => {
    const w = mount(ParseStatusBar, {
      props: {
        parseProgress: evt({
          done: 3,
          total: 12,
          filename: 'Overwatch 2 Screenshot 2026.05.24 - 22.36.31.03.png',
          screenshot_type: 'scoreboard',
        }),
        parseLog: [],
      },
    })
    const bar = w.find('.status-bar')
    expect(bar.classes()).not.toContain('status-bar-hidden')
    // Counter is split into done/slash/total spans so font baseline is stable.
    expect(w.find('.counter-done').text()).toBe('03')
    expect(w.find('.counter-total').text()).toBe('12')
    expect(w.find('.type-tag').text()).toBe('scoreboard')
    expect(w.find('.filename').text()).toContain('22.36.31.03.png')
  })

  it('fills the right number of segmented ticks proportionally', () => {
    const w = mount(ParseStatusBar, {
      props: {
        parseProgress: evt({ done: 5, total: 20, filename: 'x.png' }),
        parseLog: [],
      },
    })
    const ticks = w.findAll('.tick')
    expect(ticks.length).toBe(20)
    // 5/20 → 5 filled ticks (the rounding is straight Math.round in the component).
    expect(ticks.filter(t => t.classes().includes('tick-filled')).length).toBe(5)
  })

  it('emits go-to-view=ingest when the bar is clicked', async () => {
    const w = mount(ParseStatusBar, {
      props: {
        parseProgress: evt({ done: 1, total: 4, filename: 'a.png' }),
        parseLog: [],
      },
    })
    await w.find('.status-bar').trigger('click')
    expect(w.emitted('go-to-view')).toBeTruthy()
    expect(w.emitted('go-to-view')![0]).toEqual(['ingest'])
  })

  it('stays visible for a 1.5s grace period after the parse completes', async () => {
    vi.useFakeTimers()
    try {
      const w = mount(ParseStatusBar, {
        props: {
          parseProgress: evt({ done: 1, total: 3, filename: 'a.png' }),
          parseLog: [],
        },
      })
      // Mid-parse → visible.
      expect(w.find('.status-bar').classes()).not.toContain('status-bar-hidden')

      // Bump to done === total → bar should remain visible during grace.
      await w.setProps({ parseProgress: evt({ done: 3, total: 3, filename: 'a.png' }) })
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
    const w = mount(ParseStatusBar, {
      props: { parseProgress: null, parseLog: [] },
    })
    const bar = w.find('.status-bar')
    expect(bar.attributes('aria-hidden')).toBe('true')
    expect(bar.attributes('inert')).toBe('')
  })
})

describe('ParseStatusBar — ABORT tile (item 15 extension)', () => {
  it('renders the ABORT button while a parse is in flight', () => {
    const w = mount(ParseStatusBar, {
      props: {
        parseProgress: evt({ done: 1, total: 5, filename: 'a.png' }),
        parseLog: [],
      },
    })
    const btn = w.find('[data-testid="status-bar-cancel-btn"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('ABORT')
    expect(btn.attributes('aria-label')).toBe('Abort parse')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('does NOT render the ABORT button when no parse is in flight', () => {
    const w = mount(ParseStatusBar, {
      props: { parseProgress: null, parseLog: [] },
    })
    expect(w.find('[data-testid="status-bar-cancel-btn"]').exists()).toBe(false)
  })

  it('flips to "ABORTING" + disables itself when cancellingParse is true', () => {
    const w = mount(ParseStatusBar, {
      props: {
        parseProgress: evt({ done: 1, total: 5, filename: 'a.png' }),
        parseLog: [],
        cancellingParse: true,
      },
    })
    const btn = w.find('[data-testid="status-bar-cancel-btn"]')
    expect(btn.text()).toContain('ABORTING')
    expect(btn.attributes('aria-label')).toBe('Aborting parse')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('click on ABORT emits cancel-parse and NOT go-to-view', async () => {
    const w = mount(ParseStatusBar, {
      props: {
        parseProgress: evt({ done: 1, total: 5, filename: 'a.png' }),
        parseLog: [],
      },
    })
    await w.find('[data-testid="status-bar-cancel-btn"]').trigger('click')
    expect(w.emitted('cancel-parse')).toBeTruthy()
    expect(w.emitted('cancel-parse')).toHaveLength(1)
    // The bar's outer click handler must NOT fire (data-no-jump +
    // @click.stop) so the user doesn't get yanked to Ingest at the
    // same moment they hit Abort.
    expect(w.emitted('go-to-view')).toBeFalsy()
  })

  it('clicking elsewhere on the bar still emits go-to-view (regression guard)', async () => {
    const w = mount(ParseStatusBar, {
      props: {
        parseProgress: evt({ done: 1, total: 5, filename: 'a.png' }),
        parseLog: [],
      },
    })
    await w.find('.counter').trigger('click')
    expect(w.emitted('go-to-view')).toBeTruthy()
    expect(w.emitted('go-to-view')![0]).toEqual(['ingest'])
  })
})

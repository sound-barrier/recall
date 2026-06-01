import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import MastheadParseChip from './MastheadParseChip.vue'
import type { ParseProgressEvent } from './ParseProgressPanel.vue'

const evt = (over: Partial<ParseProgressEvent> = {}): ParseProgressEvent => ({
  done: 0,
  total: 0,
  filename: '',
  ...over,
})

describe('MastheadParseChip', () => {
  it('does not render when no parse is in flight', () => {
    const w = mount(MastheadParseChip, { props: { parseProgress: null } })
    expect(w.find('.masthead-parse-chip').exists()).toBe(false)
  })

  it('renders the done / total counter and a progress bar fill', () => {
    const w = mount(MastheadParseChip, {
      props: { parseProgress: evt({ done: 12, total: 47, filename: 'x.png' }) },
    })
    expect(w.find('.mpc-done').text()).toBe('12')
    expect(w.find('.mpc-total').text()).toBe('47')
    // 12/47 ≈ 25.5% → Math.round → 26%
    const fill = w.find('.mpc-fill')
    expect((fill.element as HTMLElement).style.width).toBe('26%')
  })

  it('exposes role=progressbar with aria-valuemin/max/now', () => {
    const w = mount(MastheadParseChip, {
      props: { parseProgress: evt({ done: 3, total: 9 }) },
    })
    const bar = w.find('[role="progressbar"]')
    expect(bar.exists()).toBe(true)
    expect(bar.attributes('aria-valuemin')).toBe('0')
    expect(bar.attributes('aria-valuemax')).toBe('9')
    expect(bar.attributes('aria-valuenow')).toBe('3')
  })

  it('emits go-to-view=ingest when clicked', async () => {
    const w = mount(MastheadParseChip, {
      props: { parseProgress: evt({ done: 1, total: 4 }) },
    })
    await w.find('.masthead-parse-chip').trigger('click')
    expect(w.emitted('go-to-view')).toBeTruthy()
    expect(w.emitted('go-to-view')![0]).toEqual(['ingest'])
  })

  it('lingers briefly after done === total, then disappears', async () => {
    vi.useFakeTimers()
    try {
      const w = mount(MastheadParseChip, {
        props: { parseProgress: evt({ done: 1, total: 3 }) },
      })
      expect(w.find('.masthead-parse-chip').exists()).toBe(true)

      // Final tick.
      await w.setProps({ parseProgress: evt({ done: 3, total: 3 }) })
      expect(w.find('.masthead-parse-chip').exists()).toBe(true)

      // After the settle window, the chip should be gone.
      vi.advanceTimersByTime(1501)
      await w.vm.$nextTick()
      expect(w.find('.masthead-parse-chip').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the settle timer when a new parse run picks up', async () => {
    vi.useFakeTimers()
    try {
      const w = mount(MastheadParseChip, {
        props: { parseProgress: evt({ done: 3, total: 3 }) },
      })
      // Arm the settle timer.
      await w.setProps({ parseProgress: evt({ done: 0, total: 0 }) })

      // A fresh in-flight parse arrives before the settle window elapses.
      await w.setProps({ parseProgress: evt({ done: 1, total: 8 }) })
      vi.advanceTimersByTime(1600)
      await w.vm.$nextTick()
      // Still visible — the new run kept the chip up.
      expect(w.find('.masthead-parse-chip').exists()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

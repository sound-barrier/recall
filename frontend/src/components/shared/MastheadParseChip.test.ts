import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { nextTick } from 'vue'
import MastheadParseChip from '@/components/shared/MastheadParseChip.vue'
import type { ParseProgressEvent } from '@/components/ingest/parse-progress'

const evt = (over: Partial<ParseProgressEvent> = {}): ParseProgressEvent => ({
  done: 0,
  total: 0,
  filename: '',
  screenshot_type: '',
  ...over,
})

const chip = () => screen.queryByRole('button', { name: 'Parse queue progress — open Parse tab' })

describe('MastheadParseChip', () => {
  it('does not render when no parse is in flight', () => {
    render(MastheadParseChip, { props: { parseProgress: null } })
    expect(chip()).not.toBeInTheDocument()
  })

  it('renders the done / total counter', () => {
    render(MastheadParseChip, {
      props: { parseProgress: evt({ done: 12, total: 47, filename: 'x.png' }) },
    })
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('47')).toBeInTheDocument()
  })

  it('paints the fill to the rounded percentage', () => {
    const { baseElement } = render(MastheadParseChip, {
      props: { parseProgress: evt({ done: 12, total: 47, filename: 'x.png' }) },
    })
    // 12/47 ≈ 25.5% → Math.round → 26%. This width is the ONLY expression
    // of the rounded + clamped pct, and it can never gain an accessible
    // surface: the fill sits in an aria-hidden track inside the chip
    // <button>, and a button's descendants are presentational, so a role
    // put here would never reach the a11y tree. Style assertion by
    // necessity — the counter test above covers the user-facing numbers.
    // eslint-disable-next-line testing-library/no-node-access, no-restricted-syntax -- decorative fill inside an aria-hidden track inside a button; no queryable surface exists
    expect((baseElement.querySelector('.mpc-fill') as HTMLElement).style.width).toBe('26%')
  })

  it('exposes role=progressbar with aria-valuemin/max/now', () => {
    render(MastheadParseChip, {
      props: { parseProgress: evt({ done: 3, total: 9 }) },
    })
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '9')
    expect(bar).toHaveAttribute('aria-valuenow', '3')
  })

  it('emits go-to-view=ingest when clicked', async () => {
    const user = userEvent.setup()
    const { emitted } = render(MastheadParseChip, {
      props: { parseProgress: evt({ done: 1, total: 4 }) },
    })
    await user.click(chip()!)
    expect(emitted('go-to-view')).toBeTruthy()
    expect(emitted('go-to-view')[0]).toEqual(['ingest'])
  })

  it('lingers briefly after done === total, then disappears', async () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(MastheadParseChip, {
        props: { parseProgress: evt({ done: 1, total: 3 }) },
      })
      expect(chip()).toBeInTheDocument()

      // Final tick.
      await rerender({ parseProgress: evt({ done: 3, total: 3 }) })
      expect(chip()).toBeInTheDocument()

      // After the settle window, the chip should be gone.
      vi.advanceTimersByTime(1501)
      await nextTick()
      expect(chip()).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the settle timer when a new parse run picks up', async () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(MastheadParseChip, {
        props: { parseProgress: evt({ done: 3, total: 3 }) },
      })
      // Arm the settle timer.
      await rerender({ parseProgress: evt({ done: 0, total: 0 }) })

      // A fresh in-flight parse arrives before the settle window elapses.
      await rerender({ parseProgress: evt({ done: 1, total: 8 }) })
      vi.advanceTimersByTime(1600)
      await nextTick()
      // Still visible — the new run kept the chip up.
      expect(chip()).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

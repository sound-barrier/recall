import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/vue'
import { nextTick } from 'vue'

import SessionSummaryToast from '@/components/matches/toasts/SessionSummaryToast.vue'
import type { SessionSummary } from '@/match/dossier/match-momentum-helpers'

// This toast has no auto-dismiss. It stays until the user closes it or the
// SESSION goes stale, which makes its expiry arithmetic the whole contract —
// and that arithmetic is against an absolute instant, on a machine that
// sleeps.

const HOUR = 3_600_000

function state(over: Partial<SessionSummary & { token: number }> = {}) {
  return {
    matches: 3, w: 2, l: 1, d: 0,
    netPercent: 18, readCount: 3,
    endsAt: Date.now() + HOUR,
    startedAt: Date.now() - HOUR,
    token: 1,
    ...over,
  }
}

describe('SessionSummaryToast', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('shows the session tally', () => {
    render(SessionSummaryToast, { props: { state: state() } })

    expect(screen.getByText(/2W/)).toBeInTheDocument()
  })

  it('stays up well past the six seconds it used to last', async () => {
    const onDismiss = vi.fn()
    render(SessionSummaryToast, { props: { state: state(), onDismiss } })

    await vi.advanceTimersByTimeAsync(30_000)

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('dismisses itself once the session goes stale', async () => {
    const onDismiss = vi.fn()
    render(SessionSummaryToast, { props: { state: state({ endsAt: Date.now() + 90_000 }), onDismiss } })

    await vi.advanceTimersByTimeAsync(2 * 60_000)

    expect(onDismiss).toHaveBeenCalledWith(1)
  })

  // The sleep case. setTimeout counts awake time, so a machine suspended past
  // the deadline wakes with the timer still pending; only a fresh look at the
  // wall clock catches it. Simulated by jumping the clock without letting the
  // timers run.
  it('expires on the real clock, not on elapsed awake time', async () => {
    const onDismiss = vi.fn()
    render(SessionSummaryToast, { props: { state: state({ endsAt: Date.now() + 3 * HOUR }), onDismiss } })

    vi.setSystemTime(Date.now() + 12 * HOUR)
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()

    expect(onDismiss).toHaveBeenCalledWith(1)
  })

  // Absent, not zero: a session whose rank pills went unread has an unknown
  // movement, and printing +0% would claim it stood still.
  it('omits the movement when no capture in the session reported one', () => {
    render(SessionSummaryToast, { props: { state: state({ readCount: 0, netPercent: 0 }) } })

    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })
})

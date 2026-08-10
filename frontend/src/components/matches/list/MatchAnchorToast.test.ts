import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import MatchAnchorToast from '@/components/matches/list/MatchAnchorToast.vue'

type ToastState = { kind: 'set' | 'cleared'; label: string; token: number } | null

// The toast teleports to <body> with role="status", so every query
// runs through screen (document-scoped) rather than the container.
function renderToast(state: ToastState) {
  return render(MatchAnchorToast, { props: { state } })
}

describe('MatchAnchorToast', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  // Fake timers are active, so user-event must drive the clock itself.
  const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

  it('renders nothing when state is null', () => {
    renderToast(null)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders the set copy + view-filter action when state.kind is "set"', () => {
    renderToast({ kind: 'set', label: '2026-05-03 · rialto', token: 1 })
    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent(/reference set/i)
    expect(toast).toHaveTextContent(/2026-05-03/)
    expect(screen.getByRole('button', { name: 'View filter' })).toBeInTheDocument()
  })

  it('renders the cleared copy and NO view-filter action when state.kind is "cleared"', () => {
    renderToast({ kind: 'cleared', label: '', token: 2 })
    expect(screen.getByRole('status')).toHaveTextContent(/reference cleared/i)
    expect(screen.queryByRole('button', { name: 'View filter' })).not.toBeInTheDocument()
  })

  it('emits view-filter when the "View filter" button is clicked (set state)', async () => {
    const { emitted } = renderToast({ kind: 'set', label: 'x', token: 3 })
    await user().click(screen.getByRole('button', { name: 'View filter' }))
    expect(emitted('view-filter')).toBeTruthy()
  })

  it('emits dismiss when the × is clicked', async () => {
    const { emitted } = renderToast({ kind: 'set', label: 'x', token: 4 })
    await user().click(screen.getByRole('button', { name: 'Dismiss anchor confirmation' }))
    expect(emitted('dismiss')).toBeTruthy()
    expect(emitted('dismiss')[0]).toEqual([4])
  })

  it('auto-dismisses after the auto-dismiss window', () => {
    const { emitted } = renderToast({ kind: 'set', label: 'x', token: 5 })
    vi.advanceTimersByTime(4600)
    expect(emitted('dismiss')).toBeTruthy()
    expect(emitted('dismiss')[0]).toEqual([5])
  })

  it('a new token resets the auto-dismiss countdown', async () => {
    const { emitted, rerender } = renderToast({ kind: 'set', label: 'a', token: 1 })
    vi.advanceTimersByTime(3000)
    await rerender({ state: { kind: 'set', label: 'b', token: 2 } })
    // 3s after the SECOND token — should not have fired yet (window is ~4.5s).
    vi.advanceTimersByTime(3000)
    expect(emitted('dismiss')).toBeFalsy()
    // Past the window from the second token — fires once.
    vi.advanceTimersByTime(2000)
    expect(emitted('dismiss')).toHaveLength(1)
    expect(emitted('dismiss')[0]).toEqual([2])
  })
})

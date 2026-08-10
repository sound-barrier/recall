import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import DashboardUndoToast from '@/components/dashboard/DashboardUndoToast.vue'

function trashed(opts: Partial<{ id: string; eyebrow: string; row: number; idx: number; token: number }> = {}) {
  return {
    id: opts.id ?? 'winrate',
    eyebrow: opts.eyebrow ?? 'Winrate',
    row: opts.row ?? 1,
    idx: opts.idx ?? 0,
    token: opts.token ?? 1,
  }
}

// The toast teleports to <body> with role="status", so every query
// runs through screen (document-scoped) rather than the container.
describe('DashboardUndoToast', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  // Fake timers are active, so user-event must drive the clock itself.
  const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

  it('renders nothing when trashed=null', async () => {
    render(DashboardUndoToast, { props: { trashed: null } })
    await nextTick()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders the toast with the widget eyebrow when trashed is provided', async () => {
    render(DashboardUndoToast, {
      props: { trashed: trashed({ eyebrow: 'Total time played' }) },
    })
    await nextTick()
    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('Total time played')
  })

  it('emits undo when Undo button is clicked', async () => {
    const { emitted } = render(DashboardUndoToast, {
      props: { trashed: trashed({ token: 42 }) },
    })
    await nextTick()
    await user().click(screen.getByRole('button', { name: 'Undo' }))
    expect(emitted('undo')).toBeTruthy()
    expect(emitted('undo')[0]).toEqual([42])
  })

  it('emits dismiss when the × button is clicked', async () => {
    const { emitted } = render(DashboardUndoToast, {
      props: { trashed: trashed({ token: 7 }) },
    })
    await nextTick()
    await user().click(screen.getByRole('button', { name: 'Dismiss undo prompt' }))
    expect(emitted('dismiss')).toBeTruthy()
    expect(emitted('dismiss')[0]).toEqual([7])
  })

  it('auto-emits dismiss after the 6-second window expires', async () => {
    const { emitted } = render(DashboardUndoToast, {
      props: { trashed: trashed({ token: 1 }) },
    })
    await nextTick()
    vi.advanceTimersByTime(6500)
    await nextTick()
    expect(emitted('dismiss')).toBeTruthy()
  })
})

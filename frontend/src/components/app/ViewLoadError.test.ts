import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import ViewLoadError from '@/components/app/ViewLoadError.vue'

// The failure boundary for a lazy chunk that would not load — a network
// drop, or a redeploy that invalidated the old hashed filenames. Losing
// view state to a reload is acceptable here; a blank pane is not.

describe('ViewLoadError', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('announces itself rather than sitting there as a blank pane', () => {
    render(ViewLoadError)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/failed to load/i)
    // Both causes named, because the user's next move differs: check the
    // connection, or accept that the app moved underneath the session.
    expect(alert).toHaveTextContent(/connection/i)
    expect(alert).toHaveTextContent(/updated underneath/i)
  })

  it('offers the one action that can fix it', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    render(ViewLoadError)

    await userEvent.click(screen.getByRole('button', { name: 'Reload Recall' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})

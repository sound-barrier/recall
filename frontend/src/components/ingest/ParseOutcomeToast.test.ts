import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'

import ParseOutcomeToast from '@/components/ingest/ParseOutcomeToast.vue'
import { useAppStore } from '@/stores/app'
import type { ParseRunSummary } from '@/components/ingest/parse-progress'

// The end-of-run report: the tally verbatim, the failure clause only
// when something failed, the View-failed door to the Unknown tab, and
// an auto-dismiss that must not fire against a NEWER run's token.

function state(over: Partial<ParseRunSummary> = {}, token = 1) {
  return {
    files_parsed: 4,
    files_failed: 2,
    matches_updated: 3,
    ...over,
    token,
  }
}

function renderToast(s: ReturnType<typeof state> | null) {
  const pinia = createPinia()
  setActivePinia(pinia)
  return render(ParseOutcomeToast, {
    props: { state: s },
    global: { plugins: [pinia] },
  })
}

describe('ParseOutcomeToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports the tally with the failure clause and the View failed door', () => {
    renderToast(state())
    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('Parse finished — 4 read')
    expect(toast).toHaveTextContent('2 failed to read')
    expect(screen.getByRole('button', { name: 'View failed →' })).toBeInTheDocument()
  })

  it('a clean run drops the failure clause and the door', () => {
    renderToast(state({ files_failed: 0 }))
    expect(screen.getByRole('status')).not.toHaveTextContent('failed')
    expect(screen.queryByRole('button', { name: 'View failed →' })).not.toBeInTheDocument()
  })

  it('View failed lands on the Unknown tab and dismisses', async () => {
    const view = renderToast(state())
    const goTo = vi.spyOn(useAppStore(), 'goToView').mockResolvedValue(undefined)

    await fireEvent.click(screen.getByRole('button', { name: 'View failed →' }))

    expect(goTo).toHaveBeenCalledWith('unknown')
    expect(view.emitted('dismiss')).toEqual([[1]])
  })

  it('auto-dismisses with its own token after 12 s', async () => {
    const view = renderToast(state())
    vi.advanceTimersByTime(12_000)
    expect(view.emitted('dismiss')).toEqual([[1]])
  })

  it('a replaced run re-arms the timer for the new token only', async () => {
    const view = renderToast(state())
    vi.advanceTimersByTime(6_000)
    await view.rerender({ state: state({}, 2) })

    // The first token's timer was cleared; only token 2 dismisses.
    vi.advanceTimersByTime(12_000)
    expect(view.emitted('dismiss')).toEqual([[2]])
  })
})

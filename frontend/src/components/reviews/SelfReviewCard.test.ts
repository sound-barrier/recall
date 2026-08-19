import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import SelfReviewCard from '@/components/reviews/SelfReviewCard.vue'
import type { ShelfCard } from '@/match/reviews/shelf-helpers'
import { resetWriteGate, setWritesLocked } from '@/test-utils/writeGateStub'

vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

function card(over: Partial<ShelfCard> = {}): ShelfCard {
  return {
    reviewId: 'r-1', title: "Tuesday's Ana games", dayKey: '2026-08-18', finished: false,
    matchCount: 3, missingCount: 0, matchKeys: ['k1', 'k2', 'k3'],
    wld: { w: 2, l: 1, d: 0 }, rail: ['written', 'reviewed', 'bare'], writtenCount: 1,
    summaryExcerpt: 'Stop chasing flanks.', ...over,
  }
}

function renderCard(over: Partial<ShelfCard> = {}) {
  setActivePinia(createPinia())
  return render(SelfReviewCard, { props: { card: card(over) } })
}

describe('SelfReviewCard', () => {
  beforeEach(() => { vi.clearAllMocks(); resetWriteGate() })

  it('is named by the sitting and describes its state in words, not only in the rail', () => {
    renderCard()
    const article = screen.getByRole('article', { name: "Tuesday's Ana games" })
    expect(article).toHaveAccessibleDescription(/3 matches · 1 with notes · 2–1 · in progress/)
    expect(screen.getByText('Stop chasing flanks.')).toBeInTheDocument()
  })

  it('Open opens, and Delete asks before it deletes', async () => {
    const { emitted } = renderCard()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open →' }))
    expect(emitted()['open']).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(emitted()['remove']).toBeUndefined()
    await user.click(screen.getByRole('button', { name: /^Delete this review/ }))
    expect(emitted()['remove']).toHaveLength(1)
  })

  it('"Keep it" disarms the delete', async () => {
    const { emitted } = renderCard()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(emitted()['remove']).toBeUndefined()
  })

  it('Delete obeys the write gate — the attribute and the guard behind it', async () => {
    setWritesLocked(true, { session: true })
    const { emitted } = renderCard()
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button).toBeDisabled()
    // A dispatched click proves the guard, not the attribute: it neither arms
    // nor removes.
    await fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(emitted()['remove']).toBeUndefined()
  })
})

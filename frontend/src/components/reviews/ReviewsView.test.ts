import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { render, screen } from '@testing-library/vue'

import { setApiBacking, type CoachSessionView, type SelfReview } from '@/api-client'
import ReviewsView from '@/components/reviews/ReviewsView.vue'
import { qk } from '@/queries/keys'
import { useAppStore } from '@/stores/app'
import { useSelfReviewStore } from '@/stores/selfReview'
import { seedQuery } from '@/test-utils/queryTestUtils'

// Three states, one tab — and the precedence between the two rooms. A
// coaching session (someone else's loaned matches) and the player's own
// sitting can both be "open" in their stores at once; the tab shows the
// session's room, because the sitting's writes are gated while a session is
// open and a room that cannot write is not a room.

const SESSION: CoachSessionView = {
  player: { id: 'sable-id', handle: 'Sable', message: '' },
  exported_at: '2026-08-14T18:30:00Z', session_date: '2026-08-15', match_count: 1,
  coach_name: 'Ordo', summary: '', notes: [], handle_from_bundle: true,
}

const SITTING: SelfReview = {
  review_id: 'r-1', title: 'Mine', summary: '', created_at: '2026-08-18T19:00:00Z', updated_at: '2026-08-18T19:00:00Z',
  match_keys: ['match-2026-08-01T20-00-00'], notes: {},
}

function renderReviews(opts: { session?: boolean; sitting?: boolean }) {
  seedQuery(qk.coach.session, opts.session ? SESSION : null)
  seedQuery(qk.coach.matches, opts.session ? [{ match_key: 'match-2026-08-01T20-00-00', source_files: [], data: { map: 'rialto' } }] : [])
  seedQuery(qk.selfReviews, opts.sitting ? [SITTING] : [])
  seedQuery(qk.matches, [{ match_key: 'match-2026-08-01T20-00-00', source_files: [], data: { map: 'rialto' } }])
  setActivePinia(createPinia())
  setApiBacking({ GetSelfReview: vi.fn(async () => SITTING) })
  const app = useAppStore()
  app.view = 'reviews'
  if (opts.sitting) useSelfReviewStore().openId = 'r-1'
  return render(ReviewsView)
}

afterEach(() => { vi.restoreAllMocks() })

describe('ReviewsView — which room', () => {
  it('shows the shelf when neither a session nor a sitting is open', () => {
    renderReviews({})
    expect(screen.getByRole('heading', { name: 'Your own reviews' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Film room' })).not.toBeInTheDocument()
  })

  it("shows the sitting's room — your voice, your sheet — when a sitting is open", async () => {
    renderReviews({ sitting: true })
    expect(await screen.findByRole('region', { name: 'Film room' })).toBeInTheDocument()
    expect(await screen.findByRole('complementary', { name: 'Review sheet' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your matches' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your own reviews' })).not.toBeInTheDocument()
  })

  it('the coaching session wins over an open sitting', async () => {
    renderReviews({ session: true, sitting: true })
    expect(await screen.findByRole('region', { name: 'Film room' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Session sheet' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Review sheet' })).not.toBeInTheDocument()
  })
})

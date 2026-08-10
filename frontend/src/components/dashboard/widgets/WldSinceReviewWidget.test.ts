import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import WldSinceReviewWidget from '@/components/dashboard/widgets/WldSinceReviewWidget.vue'
import { renderWidget } from '@/test-utils'

describe('WldSinceReviewWidget', () => {
  it('renders em-dash when no review anchor exists', () => {
    renderWidget(WldSinceReviewWidget, { dossier: { wldSinceLastReview: null } })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/new match/)).not.toBeInTheDocument()
  })

  it('renders W / L / D when an anchor exists', () => {
    renderWidget(WldSinceReviewWidget, {
      dossier: {
        wldSinceLastReview: { w: 3, l: 1, d: 0, total: 4, referenceAt: '2026-05-30T10:00:00Z' },
      },
    })
    expect(screen.getByText('3 / 1 / 0')).toBeInTheDocument()
    // The sub pluralizes via a nested <span>es</span>, so anchor on the
    // element's own text and assert the full rendered content.
    expect(screen.getByText(/4 new match/)).toHaveTextContent(/^4 new matches$/)
  })

  it('singular "match" when total is 1', () => {
    renderWidget(WldSinceReviewWidget, {
      dossier: {
        wldSinceLastReview: { w: 1, l: 0, d: 0, total: 1, referenceAt: '2026-05-30T10:00:00Z' },
      },
    })
    expect(screen.getByText(/1 new match/)).toHaveTextContent(/^1 new match$/)
  })

  it('zero-zero-zero with "0 new matches" when anchored but no new games', () => {
    renderWidget(WldSinceReviewWidget, {
      dossier: {
        wldSinceLastReview: { w: 0, l: 0, d: 0, total: 0, referenceAt: '2026-05-30T10:00:00Z' },
      },
    })
    expect(screen.getByText('0 / 0 / 0')).toBeInTheDocument()
    expect(screen.getByText(/0 new match/)).toHaveTextContent(/^0 new matches$/)
  })

  it('puts the anchor ISO in the title attr', () => {
    renderWidget(WldSinceReviewWidget, {
      dossier: {
        wldSinceLastReview: { w: 2, l: 0, d: 0, total: 2, referenceAt: '2026-05-30T10:00:00Z' },
      },
    })
    expect(screen.getByText('2 / 0 / 0')).toHaveAttribute('title', '2026-05-30T10:00:00Z')
  })
})

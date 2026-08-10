import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import MatchesReviewedWidget from '@/components/dashboard/widgets/MatchesReviewedWidget.vue'
import { renderWidget } from '@/test-utils'

describe('MatchesReviewedWidget', () => {
  it('renders em-dash when no matches in the narrow', () => {
    renderWidget(MatchesReviewedWidget, {
      dossier: { reviewedCount: { reviewed: 0, total: 0, percent: 0 } },
    })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/% of/)).not.toBeInTheDocument()
  })

  it('renders the reviewed count and a percentage subtitle', () => {
    renderWidget(MatchesReviewedWidget, {
      dossier: { reviewedCount: { reviewed: 23, total: 47, percent: 49 } },
    })
    expect(screen.getByText('23')).toBeInTheDocument()
    // The sub pluralizes via a nested <span>es</span>, so anchor on the
    // element's own text and assert the full rendered content.
    expect(screen.getByText(/49% of 47 match/)).toHaveTextContent(/49% of 47 matches/)
  })

  it('singular "match" when total is 1', () => {
    renderWidget(MatchesReviewedWidget, {
      dossier: { reviewedCount: { reviewed: 1, total: 1, percent: 100 } },
    })
    expect(screen.getByText(/100% of 1 match/)).toHaveTextContent(/100% of 1 match$/)
  })
})

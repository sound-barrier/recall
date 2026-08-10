import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import DaysSinceReviewWidget from '@/components/dashboard/widgets/DaysSinceReviewWidget.vue'
import { renderWidget } from '@/test-utils'

describe('DaysSinceReviewWidget', () => {
  it('renders em-dash when no review has happened', () => {
    renderWidget(DaysSinceReviewWidget, {
      dossier: { daysSinceLastReview: { days: null, lastReviewedAt: null } },
    })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument()
  })

  it('renders "Today" when the last review was less than 24 hours ago', () => {
    renderWidget(DaysSinceReviewWidget, {
      dossier: { daysSinceLastReview: { days: 0, lastReviewedAt: '2026-06-02T10:00:00Z' } },
    })
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument()
  })

  it('renders the day count with "days ago" subtitle', () => {
    renderWidget(DaysSinceReviewWidget, {
      dossier: { daysSinceLastReview: { days: 4, lastReviewedAt: '2026-05-29T10:00:00Z' } },
    })
    expect(screen.getByText('4')).toBeInTheDocument()
    // The subtitle pluralizes via a nested <span>s</span>, so anchor on
    // the element's own text and assert the full rendered content.
    expect(screen.getByText('day ago')).toHaveTextContent(/^days ago$/)
  })

  it('singular "day ago" when exactly 1', () => {
    renderWidget(DaysSinceReviewWidget, {
      dossier: { daysSinceLastReview: { days: 1, lastReviewedAt: '2026-06-01T10:00:00Z' } },
    })
    expect(screen.getByText('day ago')).toHaveTextContent(/^day ago$/)
  })

  it('puts the ISO timestamp in the value title attr', () => {
    renderWidget(DaysSinceReviewWidget, {
      dossier: { daysSinceLastReview: { days: 2, lastReviewedAt: '2026-05-31T10:00:00Z' } },
    })
    expect(screen.getByText('2')).toHaveAttribute('title', '2026-05-31T10:00:00Z')
  })
})

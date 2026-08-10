import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import Recent5MatchesWidget from '@/components/dashboard/widgets/Recent5MatchesWidget.vue'
import { renderWidget } from '@/test-utils'

describe('Recent5MatchesWidget', () => {
  it('renders the empty-state message when there are no results', () => {
    renderWidget(Recent5MatchesWidget, { dossier: { recentResults: [] } })
    expect(screen.getByText('No decisive matches yet')).toBeInTheDocument()
    expect(screen.queryAllByTitle(/victory|defeat|draw/)).toHaveLength(0)
  })

  it('renders a pill per result in newest-first order with the right class', () => {
    renderWidget(Recent5MatchesWidget, {
      dossier: { recentResults: ['victory', 'defeat', 'defeat', 'victory', 'draw'] },
    })
    const pills = screen.getAllByTitle(/victory|defeat|draw/)
    expect(pills).toHaveLength(5)
    expect(pills[0]).toHaveTextContent(/^W$/)
    expect(pills[0]).toHaveClass('recent-pill-victory')
    expect(pills[1]).toHaveTextContent(/^L$/)
    expect(pills[1]).toHaveClass('recent-pill-defeat')
    expect(pills[4]).toHaveTextContent(/^D$/)
    expect(pills[4]).toHaveClass('recent-pill-draw')
  })

  it('exposes the count via data-recent-count for selector-based assertions', () => {
    const { baseElement } = renderWidget(Recent5MatchesWidget, {
      dossier: { recentResults: ['victory', 'victory', 'defeat'] },
    })
    // This test PINS the selector contract (data-recent-count) that
    // e2e specs rely on, so the node access is the point.
    // eslint-disable-next-line testing-library/no-node-access -- pins the data-recent-count selector contract used by e2e
    expect(baseElement.querySelector('.recent-pills')?.getAttribute('data-recent-count')).toBe('3')
  })
})

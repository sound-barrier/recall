import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import LongestWinStreakWidget from '@/components/dashboard/widgets/LongestWinStreakWidget.vue'
import { renderWidget } from '@/test-utils'

describe('LongestWinStreakWidget', () => {
  it('renders an em-dash when no win streak exists', () => {
    renderWidget(LongestWinStreakWidget, { dossier: { longestWinStreak: 0 } })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('win')).not.toBeInTheDocument()
    expect(screen.queryByText('wins')).not.toBeInTheDocument()
  })

  it('renders the streak count with a "wins" subtitle when > 1', () => {
    renderWidget(LongestWinStreakWidget, { dossier: { longestWinStreak: 7 } })
    expect(screen.getByText('7')).toBeInTheDocument()
    // The subtitle pluralizes via a nested <span>s</span>, so anchor on
    // the element's own text and assert the full rendered content.
    expect(screen.getByText('win')).toHaveTextContent(/^wins$/)
  })

  it('singularizes the subtitle when count === 1', () => {
    renderWidget(LongestWinStreakWidget, { dossier: { longestWinStreak: 1 } })
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('win')).toHaveTextContent(/^win$/)
  })
})

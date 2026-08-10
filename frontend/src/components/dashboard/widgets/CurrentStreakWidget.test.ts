import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import CurrentStreakWidget from '@/components/dashboard/widgets/CurrentStreakWidget.vue'
import { renderWidget } from '@/test-utils'

describe('CurrentStreakWidget', () => {
  it('renders an em-dash when there is no decisive streak', () => {
    renderWidget(CurrentStreakWidget, {
      dossier: { currentStreak: { count: 0, result: null, sinceDate: null } },
    })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/since/)).not.toBeInTheDocument()
  })

  it('renders an NW count + since-date subtitle for a win streak', () => {
    renderWidget(CurrentStreakWidget, {
      dossier: { currentStreak: { count: 5, result: 'victory', sinceDate: '2026-05-04' } },
    })
    // Visual tint pin: the W/L letter already carries the semantics,
    // the class only carries the win/loss color. No ARIA encoding.
    // eslint-disable-next-line no-restricted-syntax -- win/loss streak tint; the W/L letter carries the semantics, the class carries only the color
    expect(screen.getByText('5W')).toHaveClass('kpi-streak-win')
    expect(screen.getByText(/since 2026-05-04/)).toBeInTheDocument()
  })

  it('renders an NL count for a loss streak with the loss class', () => {
    renderWidget(CurrentStreakWidget, {
      dossier: { currentStreak: { count: 2, result: 'defeat', sinceDate: '2026-05-09' } },
    })
    // Visual tint pin — see the win-streak case above.
    // eslint-disable-next-line no-restricted-syntax -- win/loss streak tint; the W/L letter carries the semantics, the class carries only the color
    expect(screen.getByText('2L')).toHaveClass('kpi-streak-loss')
  })

  it('renders a single-match streak as 1W', () => {
    renderWidget(CurrentStreakWidget, {
      dossier: { currentStreak: { count: 1, result: 'victory', sinceDate: '2026-05-10' } },
    })
    expect(screen.getByText('1W')).toBeInTheDocument()
  })
})

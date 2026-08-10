import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import TiltQueuesWidget from '@/components/dashboard/widgets/TiltQueuesWidget.vue'
import { renderWidget } from '@/test-utils'

describe('TiltQueuesWidget', () => {
  it('praises the discipline when no sitting reached five straight losses', () => {
    renderWidget(TiltQueuesWidget, { dossier: { tiltQueues: { episodes: 0, tiltGames: 0, tiltWins: 0 } } })
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText(/discipline holds/)).toBeInTheDocument()
  })

  it('shows the episode count with the record past the 4th straight loss', () => {
    renderWidget(TiltQueuesWidget, { dossier: { tiltQueues: { episodes: 3, tiltGames: 8, tiltWins: 2 } } })
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('8 games past 4 straight losses · won 25%')).toBeInTheDocument()
  })

  it('handles the single-game grammar', () => {
    renderWidget(TiltQueuesWidget, { dossier: { tiltQueues: { episodes: 1, tiltGames: 1, tiltWins: 0 } } })
    expect(screen.getByText('1 game past 4 straight losses · won 0%')).toBeInTheDocument()
  })
})

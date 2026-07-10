import { describe, it, expect } from 'vitest'
import TiltQueuesWidget from '@/components/dashboard/widgets/TiltQueuesWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

describe('TiltQueuesWidget', () => {
  it('praises the discipline when no sitting reached five straight losses', () => {
    const w = mountWidget(TiltQueuesWidget, { dossier: { tiltQueues: { episodes: 0, tiltGames: 0, tiltWins: 0 } } })
    expect(w.find('.kpi-value').text()).toBe('0')
    expect(w.find('.kpi-sub').text()).toContain('discipline holds')
  })

  it('shows the episode count with the record past the 4th straight loss', () => {
    const w = mountWidget(TiltQueuesWidget, { dossier: { tiltQueues: { episodes: 3, tiltGames: 8, tiltWins: 2 } } })
    expect(w.find('.kpi-value').text()).toBe('3')
    expect(w.find('.kpi-sub').text()).toBe('8 games past 4 straight losses · won 25%')
  })

  it('handles the single-game grammar', () => {
    const w = mountWidget(TiltQueuesWidget, { dossier: { tiltQueues: { episodes: 1, tiltGames: 1, tiltWins: 0 } } })
    expect(w.find('.kpi-sub').text()).toBe('1 game past 4 straight losses · won 0%')
  })
})

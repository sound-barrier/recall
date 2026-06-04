import { describe, it, expect } from 'vitest'
import LongestWinStreakWidget from './LongestWinStreakWidget.vue'
import { mountWidget } from '../../test-utils/mountWidget'

describe('LongestWinStreakWidget', () => {
  it('renders an em-dash when no win streak exists', () => {
    const w = mountWidget(LongestWinStreakWidget, { dossier: { longestWinStreak: 0 } })
    expect(w.find('.kpi-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('renders the streak count with a "wins" subtitle when > 1', () => {
    const w = mountWidget(LongestWinStreakWidget, { dossier: { longestWinStreak: 7 } })
    expect(w.find('.kpi-value').text()).toBe('7')
    expect(w.find('.kpi-sub').text().trim()).toBe('wins')
  })

  it('singularises the subtitle when count === 1', () => {
    const w = mountWidget(LongestWinStreakWidget, { dossier: { longestWinStreak: 1 } })
    expect(w.find('.kpi-value').text()).toBe('1')
    expect(w.find('.kpi-sub').text().trim()).toBe('win')
  })
})

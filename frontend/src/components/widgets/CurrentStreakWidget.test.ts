import { describe, it, expect } from 'vitest'
import CurrentStreakWidget from './CurrentStreakWidget.vue'
import { mountWidget } from '../../test-utils/mountWidget'

describe('CurrentStreakWidget', () => {
  it('renders an em-dash when there is no decisive streak', () => {
    const w = mountWidget(CurrentStreakWidget, {
      dossier: { currentStreak: { count: 0, result: null, sinceDate: null } },
    })
    expect(w.find('.kpi-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('renders an NW count + since-date subtitle for a win streak', () => {
    const w = mountWidget(CurrentStreakWidget, {
      dossier: { currentStreak: { count: 5, result: 'victory', sinceDate: '2026-05-04' } },
    })
    expect(w.find('.kpi-value').text()).toBe('5W')
    expect(w.find('.kpi-value').classes()).toContain('kpi-streak-win')
    expect(w.find('.kpi-sub').text()).toContain('since 2026-05-04')
  })

  it('renders an NL count for a loss streak with the loss class', () => {
    const w = mountWidget(CurrentStreakWidget, {
      dossier: { currentStreak: { count: 2, result: 'defeat', sinceDate: '2026-05-09' } },
    })
    expect(w.find('.kpi-value').text()).toBe('2L')
    expect(w.find('.kpi-value').classes()).toContain('kpi-streak-loss')
  })

  it('renders a single-match streak as 1W', () => {
    const w = mountWidget(CurrentStreakWidget, {
      dossier: { currentStreak: { count: 1, result: 'victory', sinceDate: '2026-05-10' } },
    })
    expect(w.find('.kpi-value').text()).toBe('1W')
  })
})

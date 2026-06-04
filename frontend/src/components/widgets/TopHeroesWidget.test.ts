import { describe, it, expect } from 'vitest'
import TopHeroesWidget from './TopHeroesWidget.vue'
import { mountWidget } from '../../test-utils/mountWidget'

const hero = (key: string, totalMinutes: number, share: number, timeLabel: string, winrate = 50) => ({
  key, totalMinutes, share, timeLabel, winrate,
})

describe('TopHeroesWidget', () => {
  it('renders one row per hero with the time-label inside the bar', () => {
    const w = mountWidget(TopHeroesWidget, {
      dossier: {
        topHeroesByMinutes: [
          hero('lucio', 452, 60, '7h32min'),
          hero('mercy', 180, 24, '3h0min'),
        ],
      },
    })
    const rows = w.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.find('.bd-name').text()).toBe('lucio')
    expect(rows[0]!.find('.bd-time').text()).toBe('7h32min')
    expect(rows[0]!.find('.bd-stats').text()).toBe('60%')
  })

  it('renders the eyebrow label', () => {
    const w = mountWidget(TopHeroesWidget, { dossier: { topHeroesByMinutes: [] } })
    expect(w.find('.breakdown-eyebrow').text()).toBe('Most played heroes')
  })
})

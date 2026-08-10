import { describe, it, expect } from 'vitest'
import TopHeroesWidget from '@/components/dashboard/widgets/TopHeroesWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

const hero = (key: string, stats: { totalMinutes: number; share: number; timeLabel: string }) => ({
  key, ...stats, winrate: 50,
})

describe('TopHeroesWidget', () => {
  it('renders one row per hero with the time-label inside the bar', () => {
    const w = mountWidget(TopHeroesWidget, {
      dossier: {
        topHeroesByMinutes: [
          hero('lucio', { totalMinutes: 452, share: 60, timeLabel: '7h32min' }),
          hero('mercy', { totalMinutes: 180, share: 24, timeLabel: '3h0min' }),
        ],
      },
    })
    const rows = w.findAll('li:not(.bd-placeholder)')
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

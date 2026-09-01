import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import HeroConcentrationWidget from '@/components/dashboard/widgets/HeroConcentrationWidget.vue'
import { renderWidget } from '@/test-utils'

describe('HeroConcentrationWidget', () => {
  it('reports the pool as effective heroes, which is the number a player can act on', () => {
    renderWidget(HeroConcentrationWidget, {
      dossier: { heroConcentration: { score: 0.2, effectiveHeroes: 3.2, overReliance: '', heroes: 5, unreadHeroes: 0 } },
    })
    expect(screen.getByText('3.2')).toBeInTheDocument()
    expect(screen.getByText('5 played · spread across them')).toBeInTheDocument()
  })

  it('names the hero when over half the time is on one pick', () => {
    renderWidget(HeroConcentrationWidget, {
      dossier: { heroConcentration: { score: 0.8, effectiveHeroes: 1.4, overReliance: 'ana', heroes: 4, unreadHeroes: 0 } },
    })
    expect(screen.getByText('4 played · over half your time is ana')).toBeInTheDocument()
  })

  it('says nothing was played rather than showing a zero pool', () => {
    renderWidget(HeroConcentrationWidget, {
      dossier: { heroConcentration: { score: null, effectiveHeroes: 0, overReliance: '', heroes: 0, unreadHeroes: 0 } },
    })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('No hero play time in this set.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('describes the shape without grading it', () => {
    // A one-trick who wins is winning. The name says concentrated, not bad.
    renderWidget(HeroConcentrationWidget, {
      dossier: { heroConcentration: { score: 0.9, effectiveHeroes: 1.2, overReliance: 'ana', heroes: 3, unreadHeroes: 0 } },
    })
    expect(screen.getByRole('img', { name: '1.2 effective heroes — concentrated' })).toBeInTheDocument()
  })

  it('names the heroes whose play time it could not read', () => {
    // "5 played · spread across them" over a set where three heroes' time
    // went unread is a claim about eight heroes made from five.
    renderWidget(HeroConcentrationWidget, {
      dossier: { heroConcentration: { score: 0.2, effectiveHeroes: 4.1, overReliance: '', heroes: 5, unreadHeroes: 3 } },
    })
    expect(screen.getByText('5 played · spread across them · 3 unread')).toBeInTheDocument()
  })
})

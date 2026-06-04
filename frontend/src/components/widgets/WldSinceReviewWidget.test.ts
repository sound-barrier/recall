import { describe, it, expect } from 'vitest'
import WldSinceReviewWidget from './WldSinceReviewWidget.vue'
import { mountWidget } from '../../test-utils/mountWidget'

describe('WldSinceReviewWidget', () => {
  it('renders em-dash when no review anchor exists', () => {
    const w = mountWidget(WldSinceReviewWidget, { dossier: { wldSinceLastReview: null } })
    expect(w.find('.kda-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('renders W / L / D when an anchor exists', () => {
    const w = mountWidget(WldSinceReviewWidget, {
      dossier: {
        wldSinceLastReview: { w: 3, l: 1, d: 0, total: 4, referenceAt: '2026-05-30T10:00:00Z' },
      },
    })
    expect(w.find('.kda-value').text()).toBe('3 / 1 / 0')
    expect(w.find('.kpi-sub').text()).toMatch(/^4 new matches$/)
  })

  it('singular "match" when total is 1', () => {
    const w = mountWidget(WldSinceReviewWidget, {
      dossier: {
        wldSinceLastReview: { w: 1, l: 0, d: 0, total: 1, referenceAt: '2026-05-30T10:00:00Z' },
      },
    })
    expect(w.find('.kpi-sub').text()).toMatch(/^1 new match$/)
  })

  it('zero-zero-zero with "0 new matches" when anchored but no new games', () => {
    const w = mountWidget(WldSinceReviewWidget, {
      dossier: {
        wldSinceLastReview: { w: 0, l: 0, d: 0, total: 0, referenceAt: '2026-05-30T10:00:00Z' },
      },
    })
    expect(w.find('.kda-value').text()).toBe('0 / 0 / 0')
    expect(w.find('.kpi-sub').text()).toMatch(/^0 new matches$/)
  })

  it('puts the anchor ISO in the title attr', () => {
    const w = mountWidget(WldSinceReviewWidget, {
      dossier: {
        wldSinceLastReview: { w: 2, l: 0, d: 0, total: 2, referenceAt: '2026-05-30T10:00:00Z' },
      },
    })
    expect(w.find('.kda-value').attributes('title')).toBe('2026-05-30T10:00:00Z')
  })
})

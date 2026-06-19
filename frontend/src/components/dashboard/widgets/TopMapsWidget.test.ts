import { describe, it, expect } from 'vitest'
import TopMapsWidget from '@/components/dashboard/widgets/TopMapsWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

const entry = (key: string, total: number, share: number, winrate = 50) => ({ key, total, share, winrate })

describe('TopMapsWidget', () => {
  it('renders one row per map with name, count, share', () => {
    const w = mountWidget(TopMapsWidget, {
      dossier: { topByCount: [entry('hanamura', 3, 38), entry('kings row', 2, 25)] },
    })
    const rows = w.findAll('li:not(.bd-placeholder)')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.find('.bd-name').text()).toBe('hanamura')
    expect(rows[0]!.find('.bd-time').text()).toBe('3x')
    expect(rows[0]!.find('.bd-stats').text()).toBe('38%')
    expect((rows[0]!.find('.bd-fill').element as HTMLElement).style.width).toBe('38%')
  })

  it('renders no real rows when no maps fed it', () => {
    const w = mountWidget(TopMapsWidget, { dossier: { topByCount: [] } })
    expect(w.findAll('li:not(.bd-placeholder)')).toHaveLength(0)
  })

  it('reserves rows to the UNFILTERED count (capped at the limit), padding the filtered gap', () => {
    const w = mountWidget(TopMapsWidget, {
      // Filtered view shows 2 maps; the unfiltered set has 5 (≥ the limit).
      dossier:     { topByCount: [entry('hanamura', 3, 38), entry('kings row', 2, 25)] },
      fullDossier: { topByCount: [entry('a', 1, 20), entry('b', 1, 20), entry('c', 1, 20), entry('d', 1, 20), entry('e', 1, 20)] },
      configSeed: { 'top-maps': { limit: 5 } },
    })
    // 2 real + 3 placeholder = 5 rows → the widget keeps a constant height as the
    // active filter trims the list down from the full five.
    expect(w.findAll('li')).toHaveLength(5)
    expect(w.findAll('li.bd-placeholder')).toHaveLength(3)
  })

  it('reserves no blank padding when the unfiltered set has fewer maps than the limit', () => {
    const w = mountWidget(TopMapsWidget, {
      // Only two maps were ever played; the limit is 5 but there's nothing to
      // reserve for — no empty rows, vs the old fixed-limit padding.
      dossier:     { topByCount: [entry('hanamura', 3, 60), entry('kings row', 2, 40)] },
      fullDossier: { topByCount: [entry('hanamura', 3, 60), entry('kings row', 2, 40)] },
      configSeed: { 'top-maps': { limit: 5 } },
    })
    expect(w.findAll('li')).toHaveLength(2)
    expect(w.findAll('li.bd-placeholder')).toHaveLength(0)
  })

  it('renders the eyebrow label', () => {
    const w = mountWidget(TopMapsWidget, { dossier: { topByCount: [] } })
    expect(w.find('.breakdown-eyebrow').text()).toBe('Most played maps')
  })
})

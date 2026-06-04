import { describe, it, expect } from 'vitest'
import TopMapsWidget from './TopMapsWidget.vue'
import { mountWidget } from '../../test-utils/mountWidget'

const entry = (key: string, total: number, share: number, winrate = 50) => ({ key, total, share, winrate })

describe('TopMapsWidget', () => {
  it('renders one row per map with name, count, share', () => {
    const w = mountWidget(TopMapsWidget, {
      dossier: { topByCount: [entry('hanamura', 3, 38), entry('kings row', 2, 25)] },
    })
    const rows = w.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.find('.bd-name').text()).toBe('hanamura')
    expect(rows[0]!.find('.bd-time').text()).toBe('3x')
    expect(rows[0]!.find('.bd-stats').text()).toBe('38%')
    expect((rows[0]!.find('.bd-fill').element as HTMLElement).style.width).toBe('38%')
  })

  it('renders an empty list when no maps fed it', () => {
    const w = mountWidget(TopMapsWidget, { dossier: { topByCount: [] } })
    expect(w.findAll('li')).toHaveLength(0)
  })

  it('renders the eyebrow label', () => {
    const w = mountWidget(TopMapsWidget, { dossier: { topByCount: [] } })
    expect(w.find('.breakdown-eyebrow').text()).toBe('Most played maps')
  })
})

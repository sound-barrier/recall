import { describe, it, expect } from 'vitest'
import TopGameModesWidget from '@/components/widgets/TopGameModesWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

describe('TopGameModesWidget', () => {
  it('renders no rows for an empty list', () => {
    const w = mountWidget(TopGameModesWidget, { dossier: { topByCount: [] } })
    expect(w.findAll('li')).toHaveLength(0)
  })

  it('renders each game mode with count + share', () => {
    const w = mountWidget(TopGameModesWidget, {
      dossier: {
        topByCount: [
          { key: 'control', total: 8, share: 50, winrate: 75 },
          { key: 'hybrid',  total: 4, share: 25, winrate: 50 },
        ],
      },
    })
    const rows = w.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.find('.bd-name').text()).toBe('control')
    expect(rows[0]!.find('.bd-time').text()).toBe('8x')
    expect(rows[0]!.find('.bd-stats').text()).toBe('50%')
  })
})

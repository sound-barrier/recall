import { describe, it, expect } from 'vitest'
import QuickplayVsCompetitiveWidget from './QuickplayVsCompetitiveWidget.vue'
import { mountWidget } from '../../test-utils/mountWidget'

const entry = (key: string, total: number, share: number, winrate = 50) => ({ key, total, share, winrate })

describe('QuickplayVsCompetitiveWidget', () => {
  it('renders three fixed rows (qp / comp / unset) with share as the bar metric', () => {
    const w = mountWidget(QuickplayVsCompetitiveWidget, {
      dossier: {
        playModeBreakdown: [
          entry('quickplay',   23, 8),
          entry('competitive', 245, 87),
          entry('—',           14, 5),
        ],
      },
    })
    const rows = w.findAll('li')
    expect(rows).toHaveLength(3)

    expect(rows[0]!.find('.bd-name').text()).toBe('quickplay')
    expect(rows[0]!.find('.bd-time').text()).toBe('23x')
    expect(rows[0]!.find('.bd-stats').text()).toBe('8%')
    expect((rows[0]!.find('.bd-fill').element as HTMLElement).style.width).toBe('8%')

    expect(rows[1]!.find('.bd-name').text()).toBe('competitive')
    expect((rows[1]!.find('.bd-fill').element as HTMLElement).style.width).toBe('87%')

    expect(rows[2]!.find('.bd-name').text()).toBe('—')
    expect(rows[2]!.find('.bd-stats').text()).toBe('5%')
  })

  it('renders the eyebrow label', () => {
    const w = mountWidget(QuickplayVsCompetitiveWidget, { dossier: { playModeBreakdown: [] } })
    expect(w.find('.breakdown-eyebrow').text()).toBe('Quickplay vs Competitive')
  })

  it('renders empty when the dossier feeds an empty slice', () => {
    const w = mountWidget(QuickplayVsCompetitiveWidget, { dossier: { playModeBreakdown: [] } })
    expect(w.findAll('li')).toHaveLength(0)
  })
})

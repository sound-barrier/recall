import { describe, it, expect } from 'vitest'
import WinrateByPlayModeWidget from '@/components/dashboard/widgets/WinrateByPlayModeWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

const entry = (key: string, total: number, winrate: number, share = 0) => ({ key, total, share, winrate })

describe('WinrateByPlayModeWidget', () => {
  it('renders three rows with winrate as the bar metric and bd-time as match count', () => {
    const w = mountWidget(WinrateByPlayModeWidget, {
      dossier: {
        playModeBreakdown: [
          entry('quickplay',   23, 65),
          entry('competitive', 245, 51),
          entry('—',           14, 35),
        ],
      },
    })
    const rows = w.findAll('li')
    expect(rows).toHaveLength(3)

    expect(rows[0]!.find('.bd-name').text()).toBe('quickplay')
    expect(rows[0]!.find('.bd-stats').text()).toBe('65%')
    expect((rows[0]!.find('.bd-fill').element as HTMLElement).style.width).toBe('65%')
    // bd-time carries the sample size so the user can read significance.
    expect(rows[0]!.find('.bd-time').text()).toBe('23x')

    expect((rows[1]!.find('.bd-fill').element as HTMLElement).style.width).toBe('51%')
    expect(rows[2]!.find('.bd-stats').text()).toBe('35%')
  })

  it('renders the eyebrow label', () => {
    const w = mountWidget(WinrateByPlayModeWidget, { dossier: { playModeBreakdown: [] } })
    expect(w.find('.breakdown-eyebrow').text()).toBe('Winrate by play mode')
  })
})

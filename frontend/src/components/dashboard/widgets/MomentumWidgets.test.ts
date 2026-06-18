import { describe, it, expect } from 'vitest'
import { mountWidget } from '@/test-utils/mountWidget'
import TiltCheckWidget from '@/components/dashboard/widgets/TiltCheckWidget.vue'
import FirstGameWinrateWidget from '@/components/dashboard/widgets/FirstGameWinrateWidget.vue'
import NetRankWeekWidget from '@/components/dashboard/widgets/NetRankWeekWidget.vue'
import AvgGameLengthWidget from '@/components/dashboard/widgets/AvgGameLengthWidget.vue'
import LeaverRateWidget from '@/components/dashboard/widgets/LeaverRateWidget.vue'
import SessionsWidget from '@/components/dashboard/widgets/SessionsWidget.vue'

describe('behavioural KPI widgets', () => {
  it('TiltCheck shows win-rate after a loss with the after-a-win baseline', () => {
    const w = mountWidget(TiltCheckWidget, {
      dossier: { winrateAfterLoss: { winrate: 40, sample: 10 }, winrateAfterWin: { winrate: 60, sample: 12 } },
    })
    expect(w.find('.kpi-value').text()).toBe('40%')
    expect(w.find('.kpi-sub').text()).toContain('vs 60% after a win')
    expect(w.find('.kpi-sub').text()).toContain('10 games')
  })

  it('TiltCheck renders an em-dash and no sub when the sample is empty', () => {
    const w = mountWidget(TiltCheckWidget, { dossier: { winrateAfterLoss: { winrate: null, sample: 0 } } })
    expect(w.find('.kpi-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('FirstGameWinrate shows the session-opener win-rate + session count', () => {
    const w = mountWidget(FirstGameWinrateWidget, { dossier: { firstGameWinrate: { winrate: 55, sample: 8 } } })
    expect(w.find('.kpi-value').text()).toBe('55%')
    expect(w.find('.kpi-sub').text()).toContain('8 sessions')
  })

  it('NetRankWeek signs + colours positive and negative movement', () => {
    const up = mountWidget(NetRankWeekWidget, { dossier: { netRankWeek: 45 } })
    expect(up.find('.kpi-value').text()).toBe('+45%')
    expect(up.find('.kpi-value').classes()).toContain('kpi-up')
    const down = mountWidget(NetRankWeekWidget, { dossier: { netRankWeek: -20 } })
    expect(down.find('.kpi-value').text()).toBe('-20%')
    expect(down.find('.kpi-value').classes()).toContain('kpi-down')
  })

  it('AvgGameLength formats minutes as a clock, em-dash when null', () => {
    expect(mountWidget(AvgGameLengthWidget, { dossier: { avgGameLength: 11.5 } }).find('.kpi-value').text()).toBe('11:30')
    expect(mountWidget(AvgGameLengthWidget, { dossier: { avgGameLength: null } }).find('.kpi-value').text()).toBe('—')
  })

  it('LeaverRate shows the rate + the count fraction', () => {
    const w = mountWidget(LeaverRateWidget, { dossier: { leaverStats: { rate: 12, leaverCount: 3, total: 25 } } })
    expect(w.find('.kpi-value').text()).toBe('12%')
    expect(w.find('.kpi-sub').text()).toBe('3 of 25')
  })

  it('Sessions shows the session count', () => {
    expect(mountWidget(SessionsWidget, { dossier: { sessions: 7 } }).find('.kpi-value').text()).toBe('7')
  })
})

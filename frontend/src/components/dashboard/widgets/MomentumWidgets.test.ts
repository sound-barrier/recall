import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import { renderWidget } from '@/test-utils'
import TiltCheckWidget from '@/components/dashboard/widgets/TiltCheckWidget.vue'
import FirstGameWinrateWidget from '@/components/dashboard/widgets/FirstGameWinrateWidget.vue'
import NetRankWeekWidget from '@/components/dashboard/widgets/NetRankWeekWidget.vue'
import AvgGameLengthWidget from '@/components/dashboard/widgets/AvgGameLengthWidget.vue'
import LeaverRateWidget from '@/components/dashboard/widgets/LeaverRateWidget.vue'
import SessionsWidget from '@/components/dashboard/widgets/SessionsWidget.vue'

describe('behavioral KPI widgets', () => {
  it('TiltCheck shows win-rate after a loss with the after-a-win baseline', () => {
    renderWidget(TiltCheckWidget, {
      dossier: { winrateAfterLoss: { winrate: 40, sample: 10 }, winrateAfterWin: { winrate: 60, sample: 12 } },
    })
    expect(screen.getByText('40%')).toBeInTheDocument()
    // The sub pluralizes via a nested <span>s</span>, so anchor on the
    // element's own text and assert the full rendered content.
    expect(screen.getByText(/vs 60% after a win/)).toHaveTextContent('10 games')
  })

  it('TiltCheck renders an em-dash and no sub when the sample is empty', () => {
    renderWidget(TiltCheckWidget, { dossier: { winrateAfterLoss: { winrate: null, sample: 0 } } })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/after a win/)).not.toBeInTheDocument()
  })

  it('FirstGameWinrate shows the session-opener win-rate + session count', () => {
    renderWidget(FirstGameWinrateWidget, { dossier: { firstGameWinrate: { winrate: 55, sample: 8 } } })
    expect(screen.getByText('55%')).toBeInTheDocument()
    expect(screen.getByText(/win-rate over 8 session/)).toHaveTextContent('8 sessions')
  })

  it('NetRankWeek signs + names positive, negative and flat movement', () => {
    renderWidget(NetRankWeekWidget, { dossier: { netRankWeek: 45 } })
    // The up/down tint is spoken in the shared vocabulary, so the
    // direction reaches a screen reader and a colorblind player too.
    expect(screen.getByText('+45%')).toHaveAccessibleName('+45% — winning')
    renderWidget(NetRankWeekWidget, { dossier: { netRankWeek: -20 } })
    expect(screen.getByText('-20%')).toHaveAccessibleName('-20% — losing')
    renderWidget(NetRankWeekWidget, { dossier: { netRankWeek: 0 } })
    expect(screen.getByText('0%')).toHaveAccessibleName('0% — even')
  })

  it('AvgGameLength formats minutes as a clock, em-dash when null', () => {
    renderWidget(AvgGameLengthWidget, { dossier: { avgGameLength: 11.5 } })
    expect(screen.getByText('11:30')).toBeInTheDocument()
    renderWidget(AvgGameLengthWidget, { dossier: { avgGameLength: null } })
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('LeaverRate shows the rate + the count fraction', () => {
    renderWidget(LeaverRateWidget, { dossier: { leaverStats: { rate: 12, leaverCount: 3, total: 25 } } })
    expect(screen.getByText('12%')).toBeInTheDocument()
    expect(screen.getByText('3 of 25')).toBeInTheDocument()
  })

  it('Sessions shows the session count', () => {
    renderWidget(SessionsWidget, { dossier: { sessions: 7 } })
    expect(screen.getByText('7')).toBeInTheDocument()
  })
})

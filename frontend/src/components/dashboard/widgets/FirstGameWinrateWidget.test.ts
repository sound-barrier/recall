import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'

import FirstGameWinrateWidget from '@/components/dashboard/widgets/FirstGameWinrateWidget.vue'
import { renderWidget } from '@/test-utils'

describe('FirstGameWinrate', () => {
  it('FirstGameWinrate shows the session-opener win-rate + session count', () => {
    renderWidget(FirstGameWinrateWidget, { dossier: { firstGameWinrate: { winrate: 55, sample: 8 } } })
    expect(screen.getByText('55%')).toBeInTheDocument()
    expect(screen.getByText(/win-rate over 8 session/)).toHaveTextContent('8 sessions')
  })
})

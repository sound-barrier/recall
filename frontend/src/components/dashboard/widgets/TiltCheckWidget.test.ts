import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'

import TiltCheckWidget from '@/components/dashboard/widgets/TiltCheckWidget.vue'
import { renderWidget } from '@/test-utils'

describe('TiltCheck', () => {
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
})

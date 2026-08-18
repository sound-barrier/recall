import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'

import UphillBattleWidget from '@/components/dashboard/widgets/UphillBattleWidget.vue'
import { renderWidget } from '@/test-utils'

describe('UphillBattle', () => {
  it('uphill battles shows the count of underdog wins', () => {
    renderWidget(UphillBattleWidget, {
      dossier: { modifierRecord: { total: 7, winrate: 100 } },
    })
    expect(screen.getByText('Uphill battles')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText(/underdog/)).toBeInTheDocument()
  })

  it('renders 0 when the modifier never appears (null record)', () => {
    renderWidget(UphillBattleWidget, { dossier: { modifierRecord: null } })
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})

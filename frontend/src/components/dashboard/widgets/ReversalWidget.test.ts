import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'

import ReversalWidget from '@/components/dashboard/widgets/ReversalWidget.vue'
import { renderWidget } from '@/test-utils'

describe('Reversal', () => {
  it('reversals shows the count of favored losses', () => {
    renderWidget(ReversalWidget, {
      dossier: { modifierRecord: { total: 3, winrate: 0 } },
    })
    expect(screen.getByText('Reversals')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/favored/)).toBeInTheDocument()
  })
})

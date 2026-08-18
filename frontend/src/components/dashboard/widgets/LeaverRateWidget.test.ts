import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'

import LeaverRateWidget from '@/components/dashboard/widgets/LeaverRateWidget.vue'
import { renderWidget } from '@/test-utils'

describe('LeaverRate', () => {
  it('LeaverRate shows the rate + the count fraction', () => {
    renderWidget(LeaverRateWidget, { dossier: { leaverStats: { rate: 12, leaverCount: 3, total: 25 } } })
    expect(screen.getByText('12%')).toBeInTheDocument()
    expect(screen.getByText('3 of 25')).toBeInTheDocument()
  })
})

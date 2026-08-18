import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'

import AvgGameLengthWidget from '@/components/dashboard/widgets/AvgGameLengthWidget.vue'
import { renderWidget } from '@/test-utils'

describe('AvgGameLength', () => {
  it('AvgGameLength formats minutes as a clock, em-dash when null', () => {
    renderWidget(AvgGameLengthWidget, { dossier: { avgGameLength: 11.5 } })
    expect(screen.getByText('11:30')).toBeInTheDocument()
    renderWidget(AvgGameLengthWidget, { dossier: { avgGameLength: null } })
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

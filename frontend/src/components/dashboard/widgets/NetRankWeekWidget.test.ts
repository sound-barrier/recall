import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'

import NetRankWeekWidget from '@/components/dashboard/widgets/NetRankWeekWidget.vue'
import { renderWidget } from '@/test-utils'

describe('NetRankWeek', () => {
  it('NetRankWeek signs + names positive, negative and flat movement', () => {
    renderWidget(NetRankWeekWidget, { dossier: { netRankWeek: { netPercent: 45, readCount: 3, totalCount: 3 } } })
    // The up/down tint is spoken in the shared vocabulary, so the
    // direction reaches a screen reader and a colorblind player too.
    expect(screen.getByText('+45%')).toHaveAccessibleName('+45% — winning')
    renderWidget(NetRankWeekWidget, { dossier: { netRankWeek: { netPercent: -20, readCount: 3, totalCount: 3 } } })
    expect(screen.getByText('-20%')).toHaveAccessibleName('-20% — losing')
    renderWidget(NetRankWeekWidget, { dossier: { netRankWeek: { netPercent: 0, readCount: 3, totalCount: 3 } } })
    expect(screen.getByText('0%')).toHaveAccessibleName('0% — even')
  })
})

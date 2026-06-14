import { describe, it, expect } from 'vitest'
import AvgKdaWidget from '@/components/dashboard/widgets/AvgKdaWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

const kda = (
  qualifyingMatches: number,
  recordsTotal: number,
  label = '3.21 / 4.00 / 5.67',
) => ({
  eliminations: 3.21,
  deaths: 4.0,
  assists: 5.67,
  label,
  qualifyingMatches,
  recordsTotal,
})

describe('AvgKdaWidget', () => {
  it('renders the label when averageKDA is set', () => {
    const w = mountWidget(AvgKdaWidget, { dossier: { averageKDA: kda(3, 3) } })
    expect(w.find('.kda-value').text()).toBe('3.21 / 4.00 / 5.67')
  })

  it('renders em-dash when averageKDA is null', () => {
    const w = mountWidget(AvgKdaWidget, { dossier: { averageKDA: null } })
    expect(w.find('.kda-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('shows coverage subtitle when qualifyingMatches < recordsTotal', () => {
    const w = mountWidget(AvgKdaWidget, { dossier: { averageKDA: kda(2, 4) } })
    expect(w.find('.kpi-sub').text()).toBe('2 of 4 matches')
  })

  it('hides coverage subtitle when every record qualified', () => {
    const w = mountWidget(AvgKdaWidget, { dossier: { averageKDA: kda(4, 4) } })
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })
})

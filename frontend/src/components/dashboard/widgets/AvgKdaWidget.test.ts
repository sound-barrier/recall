import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import AvgKdaWidget from '@/components/dashboard/widgets/AvgKdaWidget.vue'
import { renderWidget } from '@/test-utils'

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
    renderWidget(AvgKdaWidget, { dossier: { averageKDA: kda(3, 3) } })
    expect(screen.getByText('3.21 / 4.00 / 5.67')).toBeInTheDocument()
  })

  it('renders em-dash when averageKDA is null', () => {
    renderWidget(AvgKdaWidget, { dossier: { averageKDA: null } })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/of \d+ matches/)).not.toBeInTheDocument()
  })

  it('shows coverage subtitle when qualifyingMatches < recordsTotal', () => {
    renderWidget(AvgKdaWidget, { dossier: { averageKDA: kda(2, 4) } })
    expect(screen.getByText('2 of 4 matches')).toBeInTheDocument()
  })

  it('hides coverage subtitle when every record qualified', () => {
    renderWidget(AvgKdaWidget, { dossier: { averageKDA: kda(4, 4) } })
    expect(screen.queryByText(/of \d+ matches/)).not.toBeInTheDocument()
  })
})

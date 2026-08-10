import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import WinrateWidget from '@/components/dashboard/widgets/WinrateWidget.vue'
import { renderWidget } from '@/test-utils'

describe('WinrateWidget', () => {
  it('renders the winrate as a percentage when set', () => {
    renderWidget(WinrateWidget, { dossier: { winrate: 67 } })
    expect(screen.getByText('67%')).toBeInTheDocument()
  })

  it('renders an em-dash when winrate is null (no decisive matches)', () => {
    renderWidget(WinrateWidget, { dossier: { winrate: null } })
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('handles 0% without falling back to em-dash', () => {
    renderWidget(WinrateWidget, { dossier: { winrate: 0 } })
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })
})

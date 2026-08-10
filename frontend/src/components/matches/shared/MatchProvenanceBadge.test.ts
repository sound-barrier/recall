import { render, screen } from '@testing-library/vue'
import { describe, it, expect } from 'vitest'
import MatchProvenanceBadge from '@/components/matches/shared/MatchProvenanceBadge.vue'

describe('MatchProvenanceBadge', () => {
  it('defaults to OCR when source is absent', () => {
    render(MatchProvenanceBadge, { props: {} })
    expect(screen.getByText('OCR')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Source: OCR/ })).toBeInTheDocument()
  })

  it('shows Edited with the edited-field count in the tooltip', () => {
    render(MatchProvenanceBadge, {
      props: { source: 'ocr_edited', editedFields: ['data.map', 'data.damage'] },
    })
    expect(screen.getByText('Edited')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('title', expect.stringContaining('2 fields'))
  })

  it('singularizes a single edited field', () => {
    render(MatchProvenanceBadge, {
      props: { source: 'ocr_edited', editedFields: ['data.map'] },
    })
    const badge = screen.getByRole('img')
    expect(badge).toHaveAttribute('title', expect.stringContaining('1 field'))
    expect(badge).not.toHaveAttribute('title', expect.stringContaining('1 fields'))
  })

  it('shows "User entered" for a hand-entered match', () => {
    render(MatchProvenanceBadge, { props: { source: 'manual' } })
    expect(screen.getByText('User entered')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Hand-entered/ })).toBeInTheDocument()
  })

  it('hides the text label in compact mode but keeps the aria-label', () => {
    render(MatchProvenanceBadge, { props: { source: 'manual', compact: true } })
    expect(screen.queryByText('User entered')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /User entered/ })).toBeInTheDocument()
  })
})

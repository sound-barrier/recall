import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/vue'

import HighlightedText from '@/components/matches/shared/HighlightedText.vue'

describe('HighlightedText', () => {
  it('wraps a case-insensitive hit in <mark class="search-hl">, preserving the original case', () => {
    render(HighlightedText, { props: { text: 'Rialto', terms: ['rialto'] } })
    const mark = screen.getByText('Rialto')
    expect(mark.tagName).toBe('MARK')
    expect(mark).toHaveClass('search-hl')
  })

  it('renders plain text (no marks) when no term hits', () => {
    const { container } = render(HighlightedText, { props: { text: 'numbani', terms: ['rialto'] } })
    expect(screen.queryByText(/.+/, { selector: 'mark' })).not.toBeInTheDocument()
    expect(container).toHaveTextContent(/^numbani$/)
  })

  it('renders plain text when there are no terms', () => {
    const { container } = render(HighlightedText, { props: { text: 'lucio', terms: [] } })
    expect(screen.queryByText(/.+/, { selector: 'mark' })).not.toBeInTheDocument()
    expect(container).toHaveTextContent(/^lucio$/)
  })

  it('splits a partial hit without gaining stray whitespace', () => {
    const { container } = render(HighlightedText, { props: { text: 'rialto', terms: ['rial'] } })
    const mark = screen.getByText('rial')
    expect(mark.tagName).toBe('MARK')
    expect(mark).toHaveClass('search-hl')
    expect(container).toHaveTextContent(/^rialto$/)
  })
})

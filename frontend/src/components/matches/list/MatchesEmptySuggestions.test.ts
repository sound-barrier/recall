import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import MatchesEmptySuggestions from '@/components/matches/list/MatchesEmptySuggestions.vue'

describe('MatchesEmptySuggestions', () => {
  it('renders nothing when suggestions is empty', () => {
    render(MatchesEmptySuggestions, { props: { suggestions: [] } })
    expect(screen.queryByText(/Try removing one filter/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders one button per suggestion', () => {
    const cleared: string[] = []
    render(MatchesEmptySuggestions, {
      props: {
        suggestions: [
          { clauseId: 'maps',   label: 'map filter',  wouldSurface: 12, clear: () => { cleared.push('maps') } },
          { clauseId: 'heroes', label: 'hero filter', wouldSurface:  8, clear: () => { cleared.push('heroes') } },
        ],
      },
    })
    expect(screen.getAllByRole('button')).toHaveLength(2)
    const mapsBtn = screen.getByRole('button', { name: 'Remove map filter — would surface 12 matches' })
    expect(mapsBtn).toHaveAttribute('data-clause-id', 'maps')
    expect(mapsBtn).toHaveTextContent('Remove map filter')
    expect(mapsBtn).toHaveTextContent('12 matches')
  })

  it('clicking a suggestion calls its clear handler', async () => {
    const user = userEvent.setup()
    const cleared: string[] = []
    render(MatchesEmptySuggestions, {
      props: {
        suggestions: [
          { clauseId: 'tags', label: 'tag filter', wouldSurface: 3, clear: () => { cleared.push('tags') } },
        ],
      },
    })
    await user.click(screen.getByRole('button', { name: /Remove tag filter/ }))
    expect(cleared).toEqual(['tags'])
  })
})

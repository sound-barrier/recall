import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import type { MatchRecord } from '@/api'
import type { SearchClause } from '@/match/search-query'

// Stub the reference-data singleton so the row renders deterministically
// without firing the once-per-session fetch (which would ECONNREFUSED in
// the test env). role() returns '' → the row falls back to the stored
// role, which is all these assertions exercise.
vi.mock('@/composables/shared/useOWData', async () => {
  const { computed } = await import('vue')
  return {
    useOWData: () => ({
      data: computed(() => null),
      mapIndex: computed(() => new Map()),
      heroIndex: computed(() => new Map()),
      mapDisplayName: (s: string | null | undefined) => s ?? '',
      heroDisplayName: (s: string | null | undefined) => s ?? '',
      heroRole: () => '',
      mapGameMode: () => '',
    }),
  }
})

const { default: MatchTableRow } = await import('@/components/matches/list/MatchTableRow.vue')

function rec(over: Partial<MatchRecord['data']> = {}, key = 'm-1'): MatchRecord {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      hero: 'lucio',
      role: 'support',
      result: 'victory',
      eliminations: 20,
      assists: 10,
      deaths: 8,
      ...over,
    },
    parsed_at: '2026-05-10T22:30:00Z',
  } as unknown as MatchRecord
}

function renderRow(props: Partial<Record<string, unknown>> = {}) {
  return render(MatchTableRow, {
    props: {
      rec: rec(),
      cardIndex: 0,
      focusedCardIndex: -1,
      selected: false,
      hasSelection: false,
      isAnchor: false,
      searchClauses: [] as SearchClause[],
      ...props,
    },
  })
}

describe('MatchTableRow', () => {
  it('renders a <tr> carrying the keyboard-nav data attributes', () => {
    renderRow({ cardIndex: 3 })
    const row = screen.getByRole('row')
    expect(row).toHaveAttribute('data-match-key', 'm-1')
    expect(row).toHaveAttribute('data-card-index', '3')
  })

  it('renders the map, split E/A/D cells, and a result chip tinted by outcome', () => {
    renderRow({ rec: rec({ result: 'defeat' }) })
    expect(screen.getByText('rialto')).toBeInTheDocument()
    // E/A/D each own a column now, not one slash-joined cell.
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.queryByText('20 / 10 / 8')).not.toBeInTheDocument()
    expect(screen.getByTitle('Filter the set to defeat')).toHaveClass('result-defeat')
  })

  it('splits play-mode and queue into their own cells', () => {
    renderRow({
      rec: { ...rec(), play_mode: 'competitive', queue_type: 'role' } as MatchRecord,
    })
    expect(screen.getByText('Competitive')).toBeInTheDocument()
    expect(screen.getByText('Role Queue')).toBeInTheDocument()
  })

  it('emits open-match with the key when the row is clicked', async () => {
    const user = userEvent.setup()
    const { emitted } = renderRow()
    await user.click(screen.getByRole('row'))
    expect(emitted('open-match')?.[0]).toEqual(['m-1'])
  })

  it('emits toggle-select (and not open-match) when the checkbox is clicked', async () => {
    const user = userEvent.setup()
    const { emitted } = renderRow()
    await user.click(screen.getByRole('checkbox', { name: 'Select match m-1' }))
    expect(emitted('toggle-select')?.[0]).toEqual(['m-1'])
    expect(emitted('open-match')).toBeUndefined()
  })

  it('marks aria-current when the row is the keyboard-focused card', () => {
    renderRow({ cardIndex: 2, focusedCardIndex: 2 })
    expect(screen.getByRole('row')).toHaveAttribute('aria-current', 'true')
  })

  it('omits aria-current when the row is not the keyboard-focused card', () => {
    renderRow({ cardIndex: 2, focusedCardIndex: 5 })
    expect(screen.getByRole('row')).not.toHaveAttribute('aria-current')
  })

  it('highlights a bare-term hit in the map cell via <mark class="search-hl">', () => {
    renderRow({ searchClauses: [{ field: null, value: 'rialto' }] satisfies SearchClause[] })
    const mark = screen.getByText('rialto')
    expect(mark.tagName).toBe('MARK')
    expect(mark).toHaveClass('search-hl')
  })

  it('renders tag chips with a leading # and highlights a tag-scoped hit', () => {
    render(MatchTableRow, {
      props: {
        rec: {
          match_key: 'm-tag',
          source_files: ['m-tag.png'],
          data: rec().data,
          parsed_at: '2026-05-10T22:30:00Z',
          annotation: { tags: ['clutch'] },
        } as unknown as MatchRecord,
        cardIndex: 0,
        selected: false,
        hasSelection: false,
        isAnchor: false,
        searchClauses: [{ field: 'tag', value: 'clutch' }] satisfies SearchClause[],
      },
    })
    expect(screen.getByRole('row')).toHaveTextContent('#clutch')
    const mark = screen.getByText('clutch')
    expect(mark.tagName).toBe('MARK')
    expect(mark).toHaveClass('search-hl')
  })

  describe('source column', () => {
    // One provenance column — the same compact badge the leaf rows
    // wear, replacing the old Edited / User-entered checkbox pair.
    it('renders the Edited badge for an OCR-then-edited match', () => {
      renderRow({ rec: { ...rec(), source: 'ocr_edited', edited_fields: ['data.damage'] } as MatchRecord })
      expect(screen.getByRole('img', { name: /Source: Edited/ })).toBeInTheDocument()
    })

    it('renders the User-entered badge for a manual match', () => {
      renderRow({ rec: { ...rec(), source: 'manual' } as MatchRecord })
      expect(screen.getByRole('img', { name: /Source: User entered/ })).toBeInTheDocument()
    })

    it('renders the OCR badge for a pure-OCR match', () => {
      renderRow()
      expect(screen.getByRole('img', { name: /Source: OCR/ })).toBeInTheDocument()
    })
  })

  describe('KDA column', () => {
    it('renders (E+A)/D trimmed to two decimals', () => {
      renderRow({
        rec: { ...rec(), data: { ...rec().data, eliminations: 20, assists: 10, deaths: 8 } } as MatchRecord,
      })
      expect(screen.getByText('3.75')).toBeInTheDocument()
    })

    it('renders an em-dash when the record carries no stats', () => {
      const base = rec()
      const { eliminations: _e, assists: _a, deaths: _d, ...bare } = base.data as Record<string, unknown>
      const { baseElement } = renderRow({ rec: { ...base, data: bare } as MatchRecord })
      // Several cells legitimately render an em-dash for missing data,
      // and a lone-row render carries no column headers to bind the KDA
      // cell to an accessible name — select the column class directly.
      // eslint-disable-next-line testing-library/no-node-access -- lone-row render has no column-header binding for the KDA cell
      expect(baseElement.querySelector('.tc-kda')?.textContent?.trim()).toBe('—')
    })
  })
})

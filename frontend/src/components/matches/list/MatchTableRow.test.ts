import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import type { MatchRecord } from '@/api'
import type { SearchClause } from '@/match/search-query'

// The row asks the write gate which clock it is in; stub it so these cases
// pin the ROW's contract without standing up Pinia + the profiles query.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))
import { resetWriteGate, setWritesLocked } from '@/test-utils/writeGateStub'

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
  // These two data-attrs are a RUNTIME contract, not test wiring: App.vue's
  // j/k keyboard nav resolves the focused row through [data-card-index], and
  // seven e2e specs address rows by [data-match-key]. Pinning them here is
  // what keeps that shared surface from being renamed silently.
  it('renders a <tr> carrying the keyboard-nav data attributes', () => {
    renderRow({ cardIndex: 3 })
    const row = screen.getByRole('row')
    // eslint-disable-next-line no-restricted-syntax -- data-match-key is a runtime contract: the keyboard-nav engine and seven e2e specs address rows by it
    expect(row).toHaveAttribute('data-match-key', 'm-1')
    // eslint-disable-next-line no-restricted-syntax -- data-card-index is a runtime contract: the keyboard-nav engine reads it to move the focus cursor
    expect(row).toHaveAttribute('data-card-index', '3')
  })

  it('renders the map, split E/A/D cells, and a result chip naming the outcome', () => {
    renderRow({ rec: rec({ result: 'defeat' }) })
    expect(screen.getByText('rialto')).toBeInTheDocument()
    // E/A/D each own a column now, not one slash-joined cell.
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.queryByText('20 / 10 / 8')).not.toBeInTheDocument()
    expect(screen.getByTitle('Filter the set to defeat')).toHaveTextContent('defeat')
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
    const box = screen.getByRole('checkbox', { name: 'Select match m-1' })
    expect(box).toHaveAttribute('aria-checked', 'false')
    await user.click(box)
    expect(emitted('toggle-select')?.[0]).toEqual(['m-1'])
    expect(emitted('open-match')).toBeUndefined()
  })

  it('reports the ticked state on the row checkbox', () => {
    renderRow({ selected: true, hasSelection: true })
    expect(screen.getByRole('checkbox', { name: 'Select match m-1' })).toHaveAttribute('aria-checked', 'true')
  })

  it('marks aria-current when the row is the keyboard-focused card', () => {
    renderRow({ cardIndex: 2, focusedCardIndex: 2 })
    expect(screen.getByRole('row')).toHaveAttribute('aria-current', 'true')
  })

  it('omits aria-current when the row is not the keyboard-focused card', () => {
    renderRow({ cardIndex: 2, focusedCardIndex: 5 })
    expect(screen.getByRole('row')).not.toHaveAttribute('aria-current')
  })

  it('highlights a bare-term hit in the map cell with a <mark>', () => {
    renderRow({ searchClauses: [{ field: null, value: 'rialto' }] satisfies SearchClause[] })
    expect(screen.getByText('rialto').tagName).toBe('MARK')
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
    expect(screen.getByText('clutch').tagName).toBe('MARK')
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
      expect(screen.getByLabelText('KDA 3.75')).toHaveTextContent('3.75')
    })

    it('renders an em-dash when the record carries no stats', () => {
      const base = rec()
      const { eliminations: _e, assists: _a, deaths: _d, ...bare } = base.data as Record<string, unknown>
      renderRow({ rec: { ...base, data: bare } as MatchRecord })
      // Several cells legitimately render a bare em-dash for missing data, so
      // the derived KDA cell names itself rather than relying on position.
      expect(screen.getByLabelText('KDA unavailable')).toHaveTextContent('—')
    })

    it('renders 0 deaths as a finite ratio rather than dividing by zero', () => {
      renderRow({ rec: rec({ eliminations: 12, assists: 6, deaths: 0 }) })
      expect(screen.getByLabelText('KDA 18')).toHaveTextContent('18')
    })
  })

  describe('unresolved OCR values', () => {
    it('labels an unknown map and hero with the raw OCR read and drops their filter chips', () => {
      renderRow({
        rec: rec({ map: '', map_raw: 'Neon Junktion', hero: '', hero_raw: 'miyazaki', role: undefined }),
      })
      expect(screen.getByText('Unknown map (Neon Junktion?)')).toBeInTheDocument()
      expect(screen.getByText('Unknown hero (miyazaki?)')).toBeInTheDocument()
      expect(screen.getByTitle('OCR read: Neon Junktion')).toBeInTheDocument()
      expect(screen.getByTitle('OCR read: miyazaki')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'unknown' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'support' })).not.toBeInTheDocument()
    })

    it('renders an em-dash OCR read when the raw text was discarded', () => {
      renderRow({ rec: rec({ map: '', map_raw: 'x', hero: '', hero_raw: 'y' }) })
      expect(screen.getByTitle('OCR read: x')).toBeInTheDocument()
    })
  })

  describe('result chip', () => {
    it('disables the chip and shows an em-dash when the record has no result', async () => {
      const { emitted } = renderRow({ rec: rec({ result: undefined }) })
      const chip = screen.getByRole('button', { name: '—' })
      expect(chip).toBeDisabled()
      await fireEvent.click(chip)
      expect(emitted('filter-cell')).toBeUndefined()
    })
  })

  describe('active narrow filters', () => {
    const ALL_PICKED = {
      maps:    new Set(['rialto']),
      modes:   new Set(['competitive']),
      queues:  new Set(['role']),
      heroes:  new Set(['lucio']),
      roles:   new Set(['support']),
      results: new Set(['victory']),
    }
    const NONE_PICKED = {
      maps: new Set<string>(), modes: new Set<string>(), queues: new Set<string>(),
      heroes: new Set<string>(), roles: new Set<string>(), results: new Set<string>(),
    }
    const CELL_NAMES = ['victory', 'rialto', 'lucio', 'support', 'Competitive', 'Role Queue']

    it('reports every cell whose value is an active pick as pressed', () => {
      renderRow({
        rec: { ...rec(), play_mode: 'competitive', queue_type: 'role' } as MatchRecord,
        activeFilters: ALL_PICKED,
      })
      for (const name of CELL_NAMES) {
        expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
      }
    })

    it('reports them unpressed when nothing is picked', () => {
      renderRow({
        rec: { ...rec(), play_mode: 'competitive', queue_type: 'role' } as MatchRecord,
        activeFilters: NONE_PICKED,
      })
      for (const name of CELL_NAMES) {
        expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
      }
    })
  })

  describe('click-to-filter', () => {
    it('emits the narrow dimension each value cell owns, without opening the row', async () => {
      const { emitted } = renderRow({
        rec: { ...rec(), play_mode: 'competitive', queue_type: 'role' } as MatchRecord,
      })
      for (const name of ['victory', 'rialto', 'lucio', 'support', 'Competitive', 'Role Queue']) {
        await fireEvent.click(screen.getByRole('button', { name }))
      }
      expect(emitted('filter-cell')).toEqual([
        ['result', 'victory'],
        ['map', 'rialto'],
        ['hero', 'lucio'],
        ['role', 'support'],
        ['mode', 'competitive'],
        ['queue', 'role'],
      ])
      expect(emitted('open-match')).toBeUndefined()
    })

    it('maps an unrecognized play mode and queue onto the unknown picks', async () => {
      const { emitted } = renderRow({ rec: rec({ playlist: undefined }) })
      await fireEvent.click(screen.getByRole('button', { name: 'Unknown mode' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Unknown mode type' }))
      expect(emitted('filter-cell')).toEqual([['mode', 'unknown'], ['queue', 'unknown']])
    })
  })

  describe('disruption stamps', () => {
    it('collapses each annotation side-set into one named stamp', () => {
      renderRow({
        rec: {
          ...rec(),
          annotation: { leavers: ['enemy', 'self'], throwers: ['team'] },
        } as unknown as MatchRecord,
      })
      expect(screen.getByRole('img', { name: 'Leaver: you, enemy' })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Thrower: teammate' })).toBeInTheDocument()
    })

    it('renders no stamp for an unannotated match', () => {
      renderRow()
      expect(screen.queryByRole('img', { name: /^Leaver/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('img', { name: /^Thrower/ })).not.toBeInTheDocument()
    })
  })

  describe('row-level interactions', () => {
    it('reports context-menu and hover intent for the hover preview', async () => {
      const { emitted } = renderRow()
      const row = screen.getByRole('row')
      await fireEvent.contextMenu(row)
      expect(emitted<[MouseEvent, string]>('row-context')?.[0]?.[1]).toBe('m-1')
      await fireEvent.mouseEnter(row)
      await fireEvent.mouseMove(row)
      await fireEvent.mouseLeave(row)
      expect(emitted<[MatchRecord, MouseEvent]>('hover-enter')?.[0]?.[0]).toMatchObject({ match_key: 'm-1' })
      expect(emitted('hover-move')).toHaveLength(1)
      expect(emitted('hover-leave')).toHaveLength(1)
    })
  })
})

// Design rule 7: while a bundle is open the table shows the PLAYER's rows,
// so the When cell reads her naive scoreboard clock — the canonical instant
// would render in the coach's zone, here a different day than the one the
// row is grouped under.
describe("MatchTableRow — the player's clock", () => {
  beforeEach(resetWriteGate)

  const LOANED = { date: '1999-01-01', finished_at: '21:14', played_at_utc: '2026-05-11T03:29:00Z' }

  it("prints the player's naive day and time while a coaching session is open", () => {
    setWritesLocked(true, { session: true })
    renderRow({ rec: rec(LOANED) })
    expect(screen.getByText('21:14')).toBeInTheDocument()
    expect(screen.getByText(/1999/)).toBeInTheDocument()
  })

  it("prints the viewer's clock outside a session", () => {
    renderRow({ rec: rec(LOANED) })
    expect(screen.queryByText('21:14')).toBeNull()
    expect(screen.queryByText(/1999/)).toBeNull()
  })
})

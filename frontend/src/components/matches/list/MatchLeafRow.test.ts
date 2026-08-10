import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'

import type { MatchRecord } from '@/api-client'
import type { SearchClause } from '@/match/search-query'

// Stub the reference-data singleton so the row renders deterministically
// without firing the once-per-session fetch. heroRole() returns '' →
// rolePlays falls back to the stored data.role, which is the shape every
// freshly-parsed record has.
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

const { default: MatchLeafRow } = await import('@/components/matches/list/MatchLeafRow.vue')

type RecData = Record<string, unknown>

function rec(over: RecData = {}, top: RecData = {}): MatchRecord {
  return {
    match_key: 'm-1',
    source_files: ['m-1.png'],
    parsed_at: '2026-05-10T22:30:00Z',
    play_mode: 'competitive',
    queue_type: 'role',
    data: {
      date: '2026-05-10',
      finished_at: '22:30',
      map: 'rialto',
      hero: 'lucio',
      role: 'support',
      result: 'victory',
      eliminations: 20,
      assists: 10,
      deaths: 8,
      ...over,
    },
    ...top,
  } as unknown as MatchRecord
}

const NO_FILTERS = {
  maps: new Set<string>(),
  modes: new Set<string>(),
  queues: new Set<string>(),
  heroes: new Set<string>(),
  roles: new Set<string>(),
  results: new Set<string>(),
}

function renderRow(props: Record<string, unknown> = {}) {
  return render(MatchLeafRow, {
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

describe('MatchLeafRow', () => {
  describe('outcome', () => {
    it('names the result strip for the outcome and filters the set on click', async () => {
      const { emitted } = renderRow({ rec: rec({ result: 'defeat' }) })
      const strip = screen.getByRole('button', { name: 'Filter by defeat' })
      expect(strip).toBeEnabled()
      await fireEvent.click(strip)
      expect(emitted('filter-cell')?.[0]).toEqual(['result', 'defeat'])
      // The chip carries the visible outcome; the strip is the affordance.
      expect(screen.getByText('defeat')).toBeInTheDocument()
    })

    it('disables the strip and shows an em-dash chip when the record has no result', async () => {
      const { emitted } = renderRow({ rec: rec({ result: undefined }) })
      const strip = screen.getByRole('button', { name: 'Result' })
      expect(strip).toBeDisabled()
      await fireEvent.click(strip)
      expect(emitted('filter-cell')).toBeUndefined()
      expect(screen.getByText('—')).toBeInTheDocument()
    })
  })

  describe('unresolved OCR values', () => {
    it('labels an unknown map and hero with the raw OCR text and offers no filter chip', () => {
      renderRow({
        rec: rec({
          map: '', map_raw: 'Neon Junktion',
          hero: '', hero_raw: 'miyazaki', role: undefined,
        }),
      })
      expect(screen.getByText('Unknown map (Neon Junktion?)')).toBeInTheDocument()
      expect(screen.getByText('Unknown hero (miyazaki?)')).toBeInTheDocument()
      // The known-value path renders a filter button named for the value;
      // the unknown path must not — there is nothing to narrow to.
      expect(screen.queryByRole('button', { name: 'unknown' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'support' })).not.toBeInTheDocument()
    })

    it('keeps the row scannable — When/mode/queue/stats still render beside an unknown map', () => {
      renderRow({ rec: rec({ map: '', map_raw: 'Neon Junktion' }) })
      expect(screen.getByText('May 10')).toBeInTheDocument()
      expect(screen.getByText('22:30')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Competitive' })).toBeInTheDocument()
      expect(screen.getByLabelText('Eliminations 20, assists 10, deaths 8')).toBeInTheDocument()
    })
  })

  describe('keyboard focus and selection', () => {
    it('marks the focused card with aria-current and drops it when focus moves on', async () => {
      const { rerender } = renderRow({ cardIndex: 4, focusedCardIndex: 4 })
      expect(screen.getByRole('listitem')).toHaveAttribute('aria-current', 'true')
      await rerender({ cardIndex: 4, focusedCardIndex: 5 })
      expect(screen.getByRole('listitem')).not.toHaveAttribute('aria-current')
    })

    it('ticks the row checkbox without opening the match', async () => {
      const { emitted, rerender } = renderRow()
      const box = screen.getByRole('checkbox', { name: 'Select match m-1' })
      expect(box).toHaveAttribute('aria-checked', 'false')
      await fireEvent.click(box)
      expect(emitted('toggle-select')?.[0]).toEqual(['m-1'])
      expect(emitted('open-match')).toBeUndefined()
      await rerender({ rec: rec(), selected: true })
      expect(screen.getByRole('checkbox', { name: 'Select match m-1' }))
        .toHaveAttribute('aria-checked', 'true')
    })
  })

  describe('annotations', () => {
    it('surfaces the anchor pin, the pin star and both disruption stamps by name', () => {
      renderRow({
        isAnchor: true,
        rec: rec({}, {
          pinned: true,
          annotation: { leavers: ['enemy', 'self'], throwers: ['team'], tags: [] },
        }),
      })
      expect(screen.getByLabelText('Current “since” anchor')).toBeInTheDocument()
      expect(screen.getByLabelText('Pinned')).toBeInTheDocument()
      // Sides are read back in canonical order regardless of API order.
      expect(screen.getByRole('img', { name: 'Leaver: you, enemy' })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Thrower: teammate' })).toBeInTheDocument()
    })

    it('renders none of those markers on a plain unpinned row', () => {
      renderRow()
      expect(screen.queryByLabelText('Current “since” anchor')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Pinned')).not.toBeInTheDocument()
      expect(screen.queryByRole('img', { name: /^Leaver/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('img', { name: /^Thrower/ })).not.toBeInTheDocument()
    })
  })

  describe('active narrow filters', () => {
    it('reports every cell whose value is an active pick as pressed', () => {
      renderRow({
        activeFilters: {
          ...NO_FILTERS,
          maps: new Set(['rialto']),
          heroes: new Set(['lucio']),
          roles: new Set(['support']),
          results: new Set(['victory']),
          modes: new Set(['competitive']),
          queues: new Set(['role']),
        },
      })
      for (const name of ['Filter by victory', 'rialto', 'lucio', 'support', 'Competitive', 'Role Queue']) {
        expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
      }
    })

    it('reports them unpressed when no pick is active', () => {
      renderRow({ activeFilters: NO_FILTERS })
      for (const name of ['Filter by victory', 'rialto', 'lucio', 'support', 'Competitive', 'Role Queue']) {
        expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
      }
    })

    it('treats an absent activeFilters prop as nothing picked', () => {
      renderRow()
      expect(screen.getByRole('button', { name: 'rialto' })).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByRole('button', { name: 'lucio' })).toHaveAttribute('aria-pressed', 'false')
    })
  })

  describe('click-to-filter', () => {
    it('emits the narrow dimension each value cell owns', async () => {
      const { emitted } = renderRow()
      await fireEvent.click(screen.getByRole('button', { name: 'rialto' }))
      await fireEvent.click(screen.getByRole('button', { name: 'lucio' }))
      await fireEvent.click(screen.getByRole('button', { name: 'support' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Competitive' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Role Queue' }))
      expect(emitted('filter-cell')).toEqual([
        ['map', 'rialto'],
        ['hero', 'lucio'],
        ['role', 'support'],
        ['mode', 'competitive'],
        ['queue', 'role'],
      ])
      // None of the cell clicks may bubble into "open the detail panel".
      expect(emitted('open-match')).toBeUndefined()
    })

    it('maps an unrecognized play mode and queue onto the unknown picks', async () => {
      const { emitted } = renderRow({ rec: rec({ playlist: undefined }, { play_mode: undefined, queue_type: undefined }) })
      await fireEvent.click(screen.getByRole('button', { name: 'Unknown mode' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Unknown mode type' }))
      expect(emitted('filter-cell')).toEqual([['mode', 'unknown'], ['queue', 'unknown']])
    })

    it('renders no role chip when nothing resolves to a role', () => {
      renderRow({ rec: rec({ role: undefined }) })
      expect(screen.queryByRole('button', { name: 'support' })).not.toBeInTheDocument()
    })
  })

  describe('row-level interactions', () => {
    it('opens the match on click, and reports context-menu and hover intent', async () => {
      const { emitted } = renderRow()
      const row = screen.getByRole('listitem')
      await fireEvent.click(row)
      expect(emitted('open-match')?.[0]).toEqual(['m-1'])
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

  describe('stat block', () => {
    it('names the E/A/D triple for assistive tech', () => {
      renderRow()
      expect(screen.getByLabelText('Eliminations 20, assists 10, deaths 8')).toBeInTheDocument()
    })

    it('renders em-dashes and a question-marked name when the stats are missing', () => {
      renderRow({ rec: rec({ eliminations: undefined, assists: undefined, deaths: undefined }) })
      const block = screen.getByLabelText('Eliminations ?, assists ?, deaths ?')
      expect(block).toHaveTextContent('—/—/—')
    })
  })

  describe('search highlighting', () => {
    it('marks bare terms in the map and hero cells and tag-scoped terms in the tag chips', () => {
      renderRow({
        rec: rec({}, { annotation: { tags: ['clutch'] } }),
        searchClauses: [
          { field: null, value: 'rial' },
          { field: 'tag', value: 'clu' },
        ] satisfies SearchClause[],
      })
      expect(screen.getByText('rial').tagName).toBe('MARK')
      expect(screen.getByText('clu').tagName).toBe('MARK')
      // The tag chip still reads as "#clutch" to a sighted user.
      expect(screen.getByRole('listitem')).toHaveTextContent('#clutch')
    })

    it('leaves the cells unmarked when no clause matches', () => {
      renderRow({ searchClauses: [{ field: null, value: 'busan' }] satisfies SearchClause[] })
      expect(screen.getByText('rialto').tagName).not.toBe('MARK')
    })
  })
})

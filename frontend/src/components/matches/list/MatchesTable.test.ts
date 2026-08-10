import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { render, screen, fireEvent } from '@testing-library/vue'

import type { MatchRecord } from '@/api-client'
import { NARROW_KEY, type NarrowApi } from '@/composables/matches/useNarrow'
import type { SearchClause } from '@/match/search-query'

// Reference data is a once-per-session fetch; stub it so the table renders
// deterministically. heroRole() returns '' → role cells fall back to the
// record's stored data.role.
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

const { default: MatchesTable } = await import('@/components/matches/list/MatchesTable.vue')

function rec(over: Record<string, unknown> = {}, key = 'm-1'): MatchRecord {
  return {
    match_key: key,
    source_files: [`${key}.png`],
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
  } as unknown as MatchRecord
}

// Minimal narrow seam: the pick handlers the table calls, plus the picked
// sets it reads back to light cells up.
function makeNarrow(picked: Partial<Record<string, Set<string>>> = {}) {
  return {
    pickMap:      vi.fn(),
    pickResult:   vi.fn(),
    pickPlayMode: vi.fn(),
    pickQueue:    vi.fn(),
    pickHero:     vi.fn(),
    pickRole:     vi.fn(),
    pickedMaps:       ref(picked.maps ?? new Set<string>()),
    pickedPlayModes:  ref(picked.modes ?? new Set<string>()),
    pickedQueues:     ref(picked.queues ?? new Set<string>()),
    pickedHeroes:     ref(picked.heroes ?? new Set<string>()),
    pickedRoles:      ref(picked.roles ?? new Set<string>()),
    pickedResults:    ref(picked.results ?? new Set<string>()),
  }
}

type TableProps = {
  records?: MatchRecord[]
  resetCounter?: number
  narrow?: ReturnType<typeof makeNarrow>
}

function renderTable(opts: TableProps = {}) {
  const records = opts.records ?? [rec()]
  const narrow = opts.narrow ?? makeNarrow()
  const view = render(MatchesTable, {
    props: {
      records,
      resetCounter: opts.resetCounter ?? 0,
      focusedCardIndex: -1,
      selectedKeys: new Set<string>(),
      anchorKey: null,
      searchClauses: [] as SearchClause[],
      narrowedIndexByKey: new Map(records.map((r, i) => [r.match_key, i])),
    },
    global: { provide: { [NARROW_KEY as symbol]: narrow as unknown as NarrowApi } },
  })
  return { ...view, narrow }
}

// Row order as the user reads it: the data rows only (the header row and the
// aria-hidden spacers are excluded; the foot carries role="status").
function dataRowText(): string[] {
  return screen.getAllByRole('row').slice(1).map((r) => r.textContent ?? '')
}

let storage: Record<string, string>
beforeEach(() => {
  // The shell reads the app store to surface a clipboard denial in the
  // error banner, so it needs a Pinia the same way every other
  // store-reading component's tests do.
  setActivePinia(createPinia())
  storage = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value },
    removeItem: (key: string) => { delete storage[key] },
    clear: () => { storage = {} },
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MatchesTable', () => {
  describe('column headers', () => {
    it('renders one header per column and starts on the persisted newest-first sort', () => {
      renderTable()
      // 13 sortable columns + the non-sortable checkbox gutter.
      expect(screen.getAllByRole('columnheader')).toHaveLength(14)
      expect(screen.getByRole('columnheader', { name: 'When' })).toHaveAttribute('aria-sort', 'descending')
      expect(screen.getByRole('columnheader', { name: 'Map' })).toHaveAttribute('aria-sort', 'none')
    })

    it('re-sorts the rows on a header click and flips direction on the next click', async () => {
      renderTable({
        records: [
          rec({ map: 'rialto' }, 'm-r'),
          rec({ map: 'busan' }, 'm-b'),
          rec({ map: 'ilios' }, 'm-i'),
        ],
      })
      const mapHeader = screen.getByRole('columnheader', { name: 'Map' })
      await fireEvent.click(mapHeader)
      expect(mapHeader).toHaveAttribute('aria-sort', 'ascending')
      expect(dataRowText().map((t) => t.match(/busan|ilios|rialto/)?.[0]))
        .toEqual(['busan', 'ilios', 'rialto'])

      await fireEvent.click(mapHeader)
      expect(mapHeader).toHaveAttribute('aria-sort', 'descending')
      expect(dataRowText().map((t) => t.match(/busan|ilios|rialto/)?.[0]))
        .toEqual(['rialto', 'ilios', 'busan'])
      // Sorting by a second column must not leave the first one claiming a sort.
      expect(screen.getByRole('columnheader', { name: 'When' })).toHaveAttribute('aria-sort', 'none')
    })

    it('shift-click appends a tie-break level instead of replacing the primary', async () => {
      renderTable({
        records: [
          rec({ result: 'defeat', map: 'busan' }, 'm-1'),
          rec({ result: 'victory', map: 'rialto' }, 'm-2'),
          rec({ result: 'victory', map: 'busan' }, 'm-3'),
        ],
      })
      await fireEvent.click(screen.getByRole('columnheader', { name: 'Result' }))
      await fireEvent.click(screen.getByRole('columnheader', { name: 'Map' }), { shiftKey: true })

      expect(screen.getByRole('columnheader', { name: 'Result' })).toHaveAttribute('aria-sort', 'ascending')
      expect(screen.getByRole('columnheader', { name: 'Map' })).toHaveAttribute('aria-sort', 'ascending')
      // victory before defeat, and within victory, busan before rialto.
      expect(dataRowText().map((t) => t.match(/busan|rialto/)?.[0])).toEqual(['busan', 'rialto', 'busan'])
    })
  })

  describe('table foot', () => {
    it('counts the set honestly, in the singular for one match', () => {
      renderTable()
      expect(screen.getByRole('status')).toHaveTextContent('End · 1 match')
    })

    it('pluralizes for a set of several', () => {
      renderTable({ records: [rec({}, 'a'), rec({}, 'b'), rec({}, 'c')] })
      expect(screen.getByRole('status')).toHaveTextContent('End · 3 matches')
    })
  })

  describe('virtualization', () => {
    it('mounts only a slice of a long set while the foot still reports the whole of it', () => {
      const records = Array.from({ length: 60 }, (_, i) => rec({}, `m-${String(i).padStart(2, '0')}`))
      renderTable({ records })
      const rendered = screen.getAllByRole('row').length - 1
      expect(rendered).toBeGreaterThan(0)
      expect(rendered).toBeLessThan(60)
      expect(screen.getByRole('status')).toHaveTextContent('End · 60 matches')
      expect(screen.getByRole('checkbox', { name: 'Select match m-00' })).toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: 'Select match m-59' })).not.toBeInTheDocument()
    })
  })

  describe('click-to-filter', () => {
    it('routes each value cell to its own narrow dimension', async () => {
      const { narrow } = renderTable()
      for (const name of ['victory', 'rialto', 'lucio', 'support', 'Competitive', 'Role Queue']) {
        await fireEvent.click(screen.getByRole('button', { name }))
      }
      expect(narrow.pickResult).toHaveBeenCalledWith('victory')
      expect(narrow.pickMap).toHaveBeenCalledWith('rialto')
      expect(narrow.pickHero).toHaveBeenCalledWith('lucio')
      expect(narrow.pickRole).toHaveBeenCalledWith('support')
      expect(narrow.pickPlayMode).toHaveBeenCalledWith('competitive')
      expect(narrow.pickQueue).toHaveBeenCalledWith('role')
    })

    it('ignores a cell with no value to narrow on', async () => {
      const { narrow } = renderTable({ records: [rec({ map: '', map_raw: undefined })] })
      // An empty map still renders a filter chip reading "unknown"; clicking it
      // must not push an empty pick into the narrow.
      await fireEvent.click(screen.getByRole('button', { name: 'unknown' }))
      expect(narrow.pickMap).not.toHaveBeenCalled()
    })

    it('reflects the active picks back onto the matching cells', () => {
      renderTable({ narrow: makeNarrow({ maps: new Set(['rialto']), heroes: new Set(['lucio']) }) })
      expect(screen.getByRole('button', { name: 'rialto' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'lucio' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'support' })).toHaveAttribute('aria-pressed', 'false')
    })
  })

  describe('row events', () => {
    it('opens the detail panel for a plain row click and forwards selection intent', async () => {
      const { emitted } = renderTable()
      await fireEvent.click(screen.getByRole('checkbox', { name: 'Select match m-1' }))
      expect(emitted('toggle-select')?.[0]).toEqual(['m-1'])
      await fireEvent.click(screen.getAllByRole('row')[1]!)
      expect(emitted('open-match')?.[0]).toEqual(['m-1'])
    })

    it('forwards context-menu and hover intent from a table row', async () => {
      const { emitted } = renderTable()
      const row = screen.getAllByRole('row')[1]!
      await fireEvent.contextMenu(row)
      expect(emitted<[MouseEvent, string]>('row-context')?.[0]?.[1]).toBe('m-1')
      await fireEvent.mouseEnter(row)
      await fireEvent.mouseMove(row)
      await fireEvent.mouseLeave(row)
      expect(emitted<[MatchRecord, MouseEvent]>('hover-enter')?.[0]?.[0]).toMatchObject({ match_key: 'm-1' })
      expect(emitted('hover-move')).toHaveLength(1)
      expect(emitted('hover-leave')).toHaveLength(1)
    })

    it('emits export-csv from the toolbar', async () => {
      const { emitted } = renderTable()
      await fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
      expect(emitted('export-csv')).toHaveLength(1)
    })
  })

  describe('column resize', () => {
    it('persists the dragged width and never sorts the column it was dragged on', async () => {
      renderTable()
      const handle = screen.getAllByTitle('Drag to resize · double-click to fit contents')[0]!
      await fireEvent.pointerDown(handle, { clientX: 200 })
      await fireEvent.pointerMove(document, { clientX: 260 })
      await fireEvent.pointerUp(document)
      // 'date' starts at its natural 132px; the drag adds 60.
      expect(JSON.parse(storage['recall.matchesTableColWidths'] ?? '{}')).toEqual({ date: 192 })
      // The handle lives inside the sortable header — the drag must not flip it.
      expect(screen.getByRole('columnheader', { name: 'When' })).toHaveAttribute('aria-sort', 'descending')
    })
  })

  describe('flat / pivot mode', () => {
    it('swaps the flat grid for the pivot builder and back', async () => {
      renderTable()
      expect(screen.getByRole('button', { name: 'Flat' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('columnheader', { name: 'When' })).toBeInTheDocument()

      await fireEvent.click(screen.getByRole('button', { name: 'Pivot' }))
      expect(screen.getByRole('button', { name: 'Pivot' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'Flat' })).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByRole('columnheader', { name: 'When' })).not.toBeInTheDocument()

      await fireEvent.click(screen.getByRole('button', { name: 'Flat' }))
      expect(screen.getByRole('columnheader', { name: 'When' })).toBeInTheDocument()
    })
  })

  describe('reset', () => {
    it('scrolls the pane back to both origins when the parent bumps the reset counter', async () => {
      const scrollTo = vi.fn()
      HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo
      const { rerender } = renderTable()
      await rerender({ resetCounter: 1 })
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
    })
  })

  describe('auto-fit a column', () => {
    // The handle measures the laid-out width of every rendered cell in the
    // column plus the header label. happy-dom reports zero geometry, so the
    // measurement primitives are stubbed and the CLAMP is what's under test.
    function stubMeasurement(contentWidth: number) {
      vi.spyOn(Range.prototype, 'getBoundingClientRect')
        .mockReturnValue({ width: contentWidth } as DOMRect)
      vi.spyOn(window, 'getComputedStyle')
        .mockReturnValue({ paddingLeft: '8px', paddingRight: '8px' } as CSSStyleDeclaration)
    }

    function storedWidths(): Record<string, number> {
      return JSON.parse(storage['recall.matchesTableColWidths'] ?? '{}') as Record<string, number>
    }

    it('sizes the column to its widest content plus the handle clearance', async () => {
      renderTable()
      const handles = screen.getAllByTitle('Drag to resize · double-click to fit contents')
      stubMeasurement(100)
      await fireEvent.dblClick(handles[0]!)
      // 100 content + 16 padding + 12 handle clearance.
      expect(storedWidths().date).toBe(128)
    })

    it('caps a runaway column at the auto-fit maximum', async () => {
      renderTable()
      const handles = screen.getAllByTitle('Drag to resize · double-click to fit contents')
      stubMeasurement(900)
      await fireEvent.dblClick(handles[0]!)
      expect(storedWidths().date).toBe(520)
    })

    it('leaves the width alone when nothing measurable is in the column', async () => {
      renderTable()
      const handles = screen.getAllByTitle('Drag to resize · double-click to fit contents')
      await fireEvent.dblClick(handles[0]!)
      expect(storedWidths()).toEqual({})
    })
  })
})

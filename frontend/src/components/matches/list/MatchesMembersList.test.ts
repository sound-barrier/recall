import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { render, screen, fireEvent } from '@testing-library/vue'

import type { MatchRecord } from '@/api-client'
import { NARROW_KEY, type NarrowApi } from '@/composables/matches/narrow/useNarrow'
import type { SearchClause } from '@/match/search-query'

// The list and its rows ask the write gate whose clock they are in; stub
// it so these cases pin the LIST's contract without a live session.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))
import { resetWriteGate, setWritesLocked } from '@/test-utils/writeGateStub'

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

const { default: MatchesMembersList } = await import('@/components/matches/list/MatchesMembersList.vue')

function rec(key: string, over: Record<string, unknown> = {}, top: Record<string, unknown> = {}): MatchRecord {
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
    ...top,
  } as unknown as MatchRecord
}

function makeNarrow() {
  return {
    pickMap:      vi.fn(),
    pickResult:   vi.fn(),
    pickPlayMode: vi.fn(),
    pickQueue:    vi.fn(),
    pickHero:     vi.fn(),
    pickRole:     vi.fn(),
    pickedMaps:      ref(new Set<string>()),
    pickedPlayModes: ref(new Set<string>()),
    pickedQueues:    ref(new Set<string>()),
    pickedHeroes:    ref(new Set<string>()),
    pickedRoles:     ref(new Set<string>()),
    pickedResults:   ref(new Set<string>()),
  }
}

function renderList(props: Record<string, unknown> = {}) {
  const narrow = makeNarrow()
  const view = render(MatchesMembersList, {
    props: {
      records: [rec('m-1')],
      groupBy: 'none',
      sortOrder: 'newest',
      density: 'comfortable',
      focusedCardIndex: -1,
      selectedKeys: new Set<string>(),
      anchorKey: null,
      searchClauses: [] as SearchClause[],
      anyNarrow: false,
      clauseExclusionCounts: [],
      ...props,
    },
    global: { provide: { [NARROW_KEY as symbol]: narrow as unknown as NarrowApi } },
  })
  return { ...view, narrow }
}

let storage: Record<string, string>
beforeEach(() => {
  // MatchesTable reads the app store to surface a clipboard denial in the
  // error banner, so rendering it needs an active Pinia.
  setActivePinia(createPinia())
  resetWriteGate()
  storage = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value },
    removeItem: (key: string) => { delete storage[key] },
    clear: () => { storage = {} },
  })
  vi.stubGlobal('IntersectionObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('MatchesMembersList', () => {
  describe('leaf-row list', () => {
    it('renders one row per match and closes with an honest count', () => {
      renderList({ records: [rec('m-1'), rec('m-2'), rec('m-3')] })
      expect(screen.getByRole('list')).toBeInTheDocument()
      expect(screen.getAllByRole('checkbox', { name: /^Select match/ })).toHaveLength(3)
      expect(screen.getByRole('status')).toHaveTextContent('End · 3 matches')
    })

    it('says "match" in the singular for a set of one', () => {
      renderList()
      expect(screen.getByRole('status')).toHaveTextContent('End · 1 match')
    })

    it('threads selection and anchor state down to the rows', () => {
      renderList({
        records: [rec('m-1'), rec('m-2')],
        selectedKeys: new Set(['m-2']),
        anchorKey: 'm-1',
      })
      expect(screen.getByRole('checkbox', { name: 'Select match m-2' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('checkbox', { name: 'Select match m-1' })).toHaveAttribute('aria-checked', 'false')
      expect(screen.getByLabelText('Current “since” anchor')).toBeInTheDocument()
    })
  })

  describe('grouped sections', () => {
    const MIXED = [
      rec('m-ocr'),
      rec('m-edit', {}, { source: 'ocr_edited', edited_fields: ['data.map'] }),
      rec('m-manual', {}, { source: 'manual' }),
    ]

    it('collapses a group to its divider and restores it on a second click', async () => {
      renderList({ records: MIXED, groupBy: 'provenance' })
      const toggle = screen.getByRole('button', { name: 'Collapse Edited group' })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('checkbox', { name: 'Select match m-edit' })).toBeInTheDocument()

      await fireEvent.click(toggle)
      const collapsed = screen.getByRole('button', { name: 'Expand Edited group' })
      expect(collapsed).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('checkbox', { name: 'Select match m-edit' })).not.toBeInTheDocument()
      // The divider keeps reporting the group's real size while collapsed.
      expect(collapsed).toHaveTextContent('1')
      // Sibling groups are untouched.
      expect(screen.getByRole('checkbox', { name: 'Select match m-manual' })).toBeInTheDocument()

      await fireEvent.click(collapsed)
      expect(screen.getByRole('checkbox', { name: 'Select match m-edit' })).toBeInTheDocument()
    })

    it('drops empty provenance buckets rather than showing an empty divider', () => {
      renderList({ records: [rec('m-ocr')], groupBy: 'provenance' })
      expect(screen.getByRole('button', { name: 'Collapse OCR generated group' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Collapse Edited group' })).not.toBeInTheDocument()
    })

    it('stamps a session divider with its W/L, span and average stat line', () => {
      renderList({
        records: [rec('m-1', { finished_at: '22:30' }), rec('m-2', { finished_at: '22:45' })],
        groupBy: 'session',
      })
      expect(screen.getByText('2W 0L · 15m · avg 20/10/8')).toBeInTheDocument()
    })

    it('pages a long grouped set and reports progress instead of an end marker', () => {
      const records = Array.from({ length: 45 }, (_, i) => rec(`m-${String(i).padStart(2, '0')}`))
      renderList({ records, groupBy: 'provenance' })
      expect(screen.getByRole('status')).toHaveTextContent('Showing 20 of 45 matches')
      expect(screen.getAllByRole('checkbox', { name: /^Select match/ })).toHaveLength(20)
    })
  })

  describe('data density', () => {
    it('replaces the leaf list with the sortable table over the same set', () => {
      renderList({ records: [rec('m-1'), rec('m-2')], density: 'data' })
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'When' })).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('End · 2 matches')
    })

    it('forwards the table toolbar\'s Export CSV up to the view', async () => {
      const { emitted } = renderList({ density: 'data' })
      await fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
      expect(emitted('export-csv')).toHaveLength(1)
    })

    it('forwards the same row intents the leaf list does', async () => {
      const { emitted } = renderList({ density: 'data' })
      const row = screen.getAllByRole('row')[1]!
      await fireEvent.click(screen.getByRole('checkbox', { name: 'Select match m-1' }))
      expect(emitted('toggle-select')?.[0]).toEqual(['m-1'])
      await fireEvent.click(row)
      expect(emitted('open-match')?.[0]).toEqual(['m-1'])
      await fireEvent.contextMenu(row)
      expect(emitted<[MouseEvent, string]>('row-context')?.[0]?.[1]).toBe('m-1')
      await fireEvent.mouseEnter(row)
      await fireEvent.mouseMove(row)
      await fireEvent.mouseLeave(row)
      expect(emitted('hover-enter')).toHaveLength(1)
      expect(emitted('hover-move')).toHaveLength(1)
      expect(emitted('hover-leave')).toHaveLength(1)
    })
  })

  describe('empty state', () => {
    it('offers a way out — clear the narrowing and the top exclusion suggestions', async () => {
      const clear = vi.fn()
      const { emitted } = renderList({
        records: [],
        anyNarrow: true,
        clauseExclusionCounts: [
          { clauseId: 'maps', label: 'the map filter', wouldSurface: 7, clear },
          { clauseId: 'heroes', label: 'the hero filter', wouldSurface: 3, clear },
          { clauseId: 'roles', label: 'the role filter', wouldSurface: 1, clear },
        ],
      })
      expect(screen.getByText('No matches in this set.')).toBeInTheDocument()
      await fireEvent.click(screen.getByRole('button', { name: 'Clear narrowing' }))
      expect(emitted('reset-narrow')).toHaveLength(1)

      // Only the top two suggestions are surfaced.
      expect(screen.getByRole('button', { name: /Remove the map filter/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Remove the hero filter/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Remove the role filter/ })).not.toBeInTheDocument()

      await fireEvent.click(screen.getByRole('button', { name: /Remove the map filter/ }))
      expect(clear).toHaveBeenCalledTimes(1)
    })

    it('offers no escape hatch when the corpus itself is empty', () => {
      renderList({ records: [], anyNarrow: false })
      expect(screen.getByText('No matches in this set.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Clear narrowing' })).not.toBeInTheDocument()
    })

    it('falls back to the empty state when data density has nothing to table', () => {
      renderList({ records: [], density: 'data', anyNarrow: false })
      expect(screen.queryByRole('columnheader', { name: 'When' })).not.toBeInTheDocument()
      expect(screen.getByText('No matches in this set.')).toBeInTheDocument()
    })
  })

  describe('row interactions', () => {
    it('routes each leaf-row value cell to its own narrow dimension', async () => {
      const { narrow } = renderList()
      for (const name of ['Filter by victory', 'rialto', 'lucio', 'support', 'Competitive', 'Role Queue']) {
        await fireEvent.click(screen.getByRole('button', { name }))
      }
      expect(narrow.pickResult).toHaveBeenCalledWith('victory')
      expect(narrow.pickMap).toHaveBeenCalledWith('rialto')
      expect(narrow.pickHero).toHaveBeenCalledWith('lucio')
      expect(narrow.pickRole).toHaveBeenCalledWith('support')
      expect(narrow.pickPlayMode).toHaveBeenCalledWith('competitive')
      expect(narrow.pickQueue).toHaveBeenCalledWith('role')
    })

    it('ignores a cell that carries no value to narrow on', async () => {
      const { narrow } = renderList({ records: [rec('m-1', { map: '' })] })
      await fireEvent.click(screen.getByRole('button', { name: 'unknown' }))
      expect(narrow.pickMap).not.toHaveBeenCalled()
    })

    it('forwards open / select / context / hover intent to the view', async () => {
      const { emitted } = renderList()
      const row = screen.getAllByRole('listitem')[0]!
      await fireEvent.click(row)
      expect(emitted('open-match')?.[0]).toEqual(['m-1'])
      await fireEvent.click(screen.getByRole('checkbox', { name: 'Select match m-1' }))
      expect(emitted('toggle-select')?.[0]).toEqual(['m-1'])
      await fireEvent.contextMenu(row)
      expect(emitted<[MouseEvent, string]>('row-context')?.[0]?.[1]).toBe('m-1')
      await fireEvent.mouseEnter(row)
      await fireEvent.mouseMove(row)
      await fireEvent.mouseLeave(row)
      expect(emitted('hover-enter')).toHaveLength(1)
      expect(emitted('hover-move')).toHaveLength(1)
      expect(emitted('hover-leave')).toHaveLength(1)
    })
  })
})

// Design rule 7 asks for the label once per surface: the rows print the
// player's naive clock during a session, and an unlabeled 21:14 is a lie
// to a coach in another timezone.
describe("MatchesMembersList — the player's clock", () => {
  it('labels the list once while a coaching session is open', () => {
    setWritesLocked(true, { session: true })
    renderList({ records: [rec('m-1'), rec('m-2')] })
    expect(screen.getAllByText(/Times in .+'s clock/)).toHaveLength(1)
  })

  it('says nothing about clocks outside a session', () => {
    renderList({ records: [rec('m-1')] })
    expect(screen.queryByText(/Times in .+'s clock/)).toBeNull()
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { render } from '@testing-library/vue'

import type { MatchRecord } from '@/api-client'
import type { GroupBy, SortOrder } from '@/composables/matches/useMatchesGroup'
import type { Density } from '@/composables/matches/useDensity'
import { useMembersListWindow } from '@/composables/matches/useMembersListWindow'

// The rendering window is mostly index math over the grouped sections plus
// three DOM-adjacent behaviors (the infinite-scroll observer, the j/k
// auto-scroll, the reset scroll). happy-dom reports zero geometry, so the
// scroll assertions are driven off window.innerHeight (768) and a list whose
// rect.top is 0 — the maths the composable does with those is the contract,
// not the pixel values happy-dom invents.

interface FakeEntry { isIntersecting: boolean }

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  observed: Element[] = []
  unobserved: Element[] = []
  disconnected = false
  constructor(private readonly callback: (entries: FakeEntry[]) => void) {
    FakeIntersectionObserver.instances.push(this)
  }
  observe(el: Element): void { this.observed.push(el) }
  unobserve(el: Element): void { this.unobserved.push(el) }
  disconnect(): void { this.disconnected = true }
  fire(isIntersecting = true): void { this.callback([{ isIntersecting }]) }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// `count` records inside `date`, each with a distinct finish time so the
// sort is total (and therefore deterministic) rather than stability-dependent.
function makeRecords(count: number, date: string, offset = 0): MatchRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    match_key: `${date}-${pad(offset + i)}`,
    source_files: [],
    parsed_at: `${date}T00:00:00Z`,
    data: { date, finished_at: `${pad(i % 24)}:${pad(i % 60)}` },
  }) as unknown as MatchRecord)
}

interface WindowSeed {
  records?: MatchRecord[]
  groupBy?: GroupBy
  sortOrder?: SortOrder
  density?: Density
}

function mountWindow(seed: WindowSeed = {}) {
  const records = ref<MatchRecord[]>(seed.records ?? []) as Ref<MatchRecord[]>
  const groupBy = ref<GroupBy>(seed.groupBy ?? 'none')
  const sortOrder = ref<SortOrder>(seed.sortOrder ?? 'newest')
  const density = ref<Density>(seed.density ?? 'comfortable')
  const focusedCardIndex = ref<number | undefined>(undefined)
  let api!: ReturnType<typeof useMembersListWindow>

  const view = render(defineComponent({
    setup() {
      api = useMembersListWindow({ records, groupBy, sortOrder, density, focusedCardIndex })
      return () => h('ul', { ref: api.leavesListRef }, [
        ...api.renderSections.value.flatMap((s) =>
          s.records.map((r) => h('li', { key: r.match_key, class: 'leaf-row' }, r.match_key)),
        ),
        api.hasMore.value ? h('li', { key: 'sentinel', ref: api.sentinelRef }) : null,
      ])
    },
  }))

  return { api, view, records, groupBy, sortOrder, density, focusedCardIndex }
}

// Rendered row counts per section, in render order.
function sectionShape(api: ReturnType<typeof useMembersListWindow>): [string, number][] {
  return api.renderSections.value.map((s) => [s.key, s.records.length])
}

beforeEach(() => {
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  if (typeof HTMLElement.prototype.scrollTo !== 'function') {
    HTMLElement.prototype.scrollTo = () => {}
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useMembersListWindow', () => {
  describe('paginated grouped window', () => {
    const THREE_DAYS = [
      ...makeRecords(20, '2026-05-03'),
      ...makeRecords(20, '2026-05-02'),
      ...makeRecords(5, '2026-05-01'),
    ]

    it('caps the rendered rows at one page and grows a page per sentinel hit', async () => {
      const { api } = mountWindow({ records: THREE_DAYS, groupBy: 'day' })
      const io = FakeIntersectionObserver.instances[0]
      // Page 1 exactly fills the newest day; the next divider still renders
      // (with zero rows) so the user sees there is more below.
      expect(sectionShape(api)).toEqual([['2026-05-03', 20], ['2026-05-02', 0]])
      expect(api.hasMore.value).toBe(true)

      io?.fire(true)
      await nextTick()
      expect(sectionShape(api)).toEqual([['2026-05-03', 20], ['2026-05-02', 20], ['2026-05-01', 0]])

      io?.fire(true)
      await nextTick()
      expect(sectionShape(api)).toEqual([['2026-05-03', 20], ['2026-05-02', 20], ['2026-05-01', 5]])
      expect(api.hasMore.value).toBe(false)
    })

    it('reports each divider its TRUE total, not the windowed count', () => {
      const { api } = mountWindow({ records: THREE_DAYS, groupBy: 'day' })
      expect(api.sectionTotal('2026-05-02')).toBe(20)
      expect(api.sectionTotal('2026-05-01')).toBe(5)
      expect(api.sectionTotal('no-such-day')).toBe(0)
    })

    it('renders the whole corpus in one step for expandWindowToAll', async () => {
      const { api } = mountWindow({ records: THREE_DAYS, groupBy: 'day' })
      api.expandWindowToAll()
      await nextTick()
      expect(sectionShape(api)).toEqual([['2026-05-03', 20], ['2026-05-02', 20], ['2026-05-01', 5]])
      expect(api.hasMore.value).toBe(false)
    })

    it('frees a collapsed group\'s page budget for the groups below it', async () => {
      const { api } = mountWindow({ records: THREE_DAYS, groupBy: 'day' })
      api.toggleSection('2026-05-03')
      await nextTick()
      expect(api.isCollapsed('2026-05-03')).toBe(true)
      // The collapsed divider stays (with its true total intact) and the page
      // budget it would have consumed goes to the next day.
      expect(sectionShape(api)).toEqual([['2026-05-03', 0], ['2026-05-02', 20], ['2026-05-01', 0]])
      expect(api.sectionTotal('2026-05-03')).toBe(20)

      api.toggleSection('2026-05-03')
      await nextTick()
      expect(api.isCollapsed('2026-05-03')).toBe(false)
      expect(sectionShape(api)).toEqual([['2026-05-03', 20], ['2026-05-02', 0]])
    })

    it('collapses and re-expands every section at once', async () => {
      const { api } = mountWindow({ records: THREE_DAYS, groupBy: 'day' })
      api.collapseAllSections()
      await nextTick()
      expect(sectionShape(api)).toEqual([['2026-05-03', 0], ['2026-05-02', 0], ['2026-05-01', 0]])

      api.expandAllSections()
      await nextTick()
      expect(api.isCollapsed('2026-05-03')).toBe(false)
      expect(sectionShape(api)).toEqual([['2026-05-03', 20], ['2026-05-02', 0]])
    })
  })

  describe('flat virtualization', () => {
    it('renders one synthetic section holding only the visible slice, and spaces out the rest', () => {
      const { api } = mountWindow({ records: makeRecords(40, '2026-05-03'), groupBy: 'none' })
      expect(api.flatVirtualization.value).toBe(true)
      const [section] = api.renderSections.value
      expect(section?.key).toBe('all')
      // A grouped divider would carry a header; the flat pseudo-section must not.
      expect(section?.header).toBeNull()
      const rendered = section?.records.length ?? 0
      expect(rendered).toBeGreaterThan(0)
      expect(rendered).toBeLessThan(40)
      expect(api.flatTopSpacerHeight.value).toBe(0)
      expect(api.flatBottomSpacerHeight.value).toBe((40 - rendered) * 58)
    })

    it('drops both spacers once a grouping is active', async () => {
      const { api, groupBy } = mountWindow({ records: makeRecords(40, '2026-05-03'), groupBy: 'none' })
      expect(api.flatBottomSpacerHeight.value).toBeGreaterThan(0)
      groupBy.value = 'day'
      await nextTick()
      expect(api.flatVirtualization.value).toBe(false)
      expect(api.flatTopSpacerHeight.value).toBe(0)
      expect(api.flatBottomSpacerHeight.value).toBe(0)
    })
  })

  describe('infinite-scroll sentinel', () => {
    it('loads another page when the sentinel enters view, then releases it at the end', async () => {
      const { api } = mountWindow({ records: makeRecords(45, '2026-05-03'), groupBy: 'day' })
      const io = FakeIntersectionObserver.instances[0]
      expect(io?.observed).toHaveLength(1)

      io?.fire(true)
      await nextTick()
      expect(api.renderedCount.value).toBe(40)

      io?.fire(true)
      await nextTick()
      expect(api.renderedCount.value).toBe(45)
      expect(api.hasMore.value).toBe(false)
      // The sentinel <li> unmounts at the end of the list — the observer must
      // let go of the detached node rather than keep it alive.
      await nextTick()
      expect(io?.unobserved).toHaveLength(1)
    })

    it('ignores a non-intersecting entry', async () => {
      const { api } = mountWindow({ records: makeRecords(45, '2026-05-03'), groupBy: 'day' })
      FakeIntersectionObserver.instances[0]?.fire(false)
      await nextTick()
      expect(api.renderedCount.value).toBe(20)
    })

    it('disconnects the observer when the list unmounts', () => {
      const { view } = mountWindow({ records: makeRecords(45, '2026-05-03'), groupBy: 'day' })
      const io = FakeIntersectionObserver.instances[0]
      expect(io?.disconnected).toBe(false)
      view.unmount()
      expect(io?.disconnected).toBe(true)
    })
  })

  describe('reset', () => {
    it('snaps the window back to one page and scrolls the page up when the set changes', async () => {
      const { api, records } = mountWindow({ records: makeRecords(45, '2026-05-03'), groupBy: 'day' })
      api.expandWindowToAll()
      await nextTick()
      const before = api.resetCounter.value
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

      records.value = makeRecords(45, '2026-05-04')
      await nextTick()
      await nextTick()
      expect(api.renderedCount.value).toBe(20)
      expect(api.resetCounter.value).toBe(before + 1)
      // Grouped mode owns its own scroll container, so the document must not move.
      expect(scrollTo).not.toHaveBeenCalled()
    })

    it('scrolls the document back to the list top in flat mode', async () => {
      const { records } = mountWindow({ records: makeRecords(45, '2026-05-03'), groupBy: 'none' })
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
      records.value = makeRecords(45, '2026-05-04')
      await nextTick()
      await nextTick()
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
    })
  })

  describe('keyboard-focus auto-scroll', () => {
    it('leaves the page alone while the focused row is already on screen', async () => {
      const { focusedCardIndex } = mountWindow({ records: makeRecords(60, '2026-05-03'), groupBy: 'none' })
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
      focusedCardIndex.value = 2
      await nextTick()
      expect(scrollTo).not.toHaveBeenCalled()
    })

    it('brings an off-screen focused row into the upper third of the viewport', async () => {
      const { focusedCardIndex } = mountWindow({ records: makeRecords(60, '2026-05-03'), groupBy: 'none' })
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
      focusedCardIndex.value = 30
      await nextTick()
      // 30 rows × the comfortable row height, minus a third of the viewport.
      expect(scrollTo).toHaveBeenCalledWith({ top: 30 * 58 - 768 / 3, behavior: 'auto' })
    })

    it('measures the jump in compact rows once the density changes', async () => {
      const { focusedCardIndex, density } = mountWindow({ records: makeRecords(60, '2026-05-03'), groupBy: 'none' })
      density.value = 'compact'
      await nextTick()
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
      focusedCardIndex.value = 30
      await nextTick()
      expect(scrollTo).toHaveBeenCalledWith({ top: 30 * 38 - 768 / 3, behavior: 'auto' })
    })

    it('re-measures the row height from the DOM rather than trusting the constant', async () => {
      // A theme font-size override (or any layout the constants don't predict)
      // changes the real row height; the jump has to follow the measurement.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockReturnValue({ top: 0, bottom: 0, height: 44, width: 0 } as DOMRect)
      const { focusedCardIndex } = mountWindow({ records: makeRecords(60, '2026-05-03'), groupBy: 'none' })
      await nextTick()
      await nextTick()
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
      focusedCardIndex.value = 30
      await nextTick()
      // 44px measured + 2px flex gap.
      expect(scrollTo).toHaveBeenCalledWith({ top: 30 * 46 - 768 / 3, behavior: 'auto' })
    })

    it('never scrolls for a cleared focus or while a grouping is active', async () => {
      const { focusedCardIndex, groupBy } = mountWindow({ records: makeRecords(60, '2026-05-03'), groupBy: 'none' })
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
      focusedCardIndex.value = -1
      await nextTick()
      groupBy.value = 'day'
      await nextTick()
      focusedCardIndex.value = 30
      await nextTick()
      expect(scrollTo).not.toHaveBeenCalled()
    })
  })

  describe('narrowedIndexByKey', () => {
    it('indexes by the narrowed order the keyboard nav walks, not the display sort', () => {
      // Given oldest-first input rendered newest-first, j/k still counts from
      // the narrowed set's own order — that is the index data-card-index carries.
      const records = [
        ...makeRecords(1, '2026-05-01'),
        ...makeRecords(1, '2026-05-02'),
        ...makeRecords(1, '2026-05-03'),
      ]
      const { api } = mountWindow({ records, groupBy: 'none', sortOrder: 'newest' })
      expect(api.narrowedIndexByKey.value.get('2026-05-01-00')).toBe(0)
      expect(api.narrowedIndexByKey.value.get('2026-05-03-00')).toBe(2)
      expect(api.sortedRecords.value[0]?.match_key).toBe('2026-05-03-00')
    })
  })
})

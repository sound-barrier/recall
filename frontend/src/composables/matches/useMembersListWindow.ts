import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import { useMatchesGroup, type GroupBy, type GroupedSection, type SortOrder } from '@/composables/matches/useMatchesGroup'
import { useMatchesWindow } from '@/composables/matches/useMatchesWindow'
import { useVirtualWindow } from '@/composables/matches/useVirtualWindow'
import type { Density } from '@/composables/matches/useDensity'

// Flat-mode rows are uniform height; group mode mixes section dividers.
const LEAF_ROW_HEIGHT_DEFAULT = 58
const LEAF_ROW_HEIGHT_COMPACT = 38

// The members-list rendering window: sort/group → collapse → paginate (grouped)
// or virtualize (flat 'none') → render shape, plus the IntersectionObserver that
// drives infinite scroll and the auto-scroll that follows j/k focus. Extracted
// from MatchesMembersList so the SFC keeps only props, click-to-filter, and the
// markup; this owns the interdependent windowing state machine + its lifecycle.
export function useMembersListWindow(
  records: Ref<MatchRecord[]>,
  groupBy: Ref<GroupBy>,
  sortOrder: Ref<SortOrder>,
  density: Ref<Density>,
  focusedCardIndex: Ref<number | undefined>,
) {
  const { sortedRecords, groupedSections } = useMatchesGroup(records, groupBy, sortOrder)

  // ─── Collapsible group sections ────────────────────────────
  // Session-scoped; keys namespaced by grouping value so collapse memory
  // survives a round-trip through other groupings.
  const collapsedKeys = ref<Set<string>>(new Set())
  function isCollapsed(key: string): boolean {
    return collapsedKeys.value.has(key)
  }
  function toggleSection(key: string): void {
    const next = new Set(collapsedKeys.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    collapsedKeys.value = next
  }
  function collapseAllSections(): void {
    collapsedKeys.value = new Set(groupedSections.value.map((s) => s.key))
  }
  function expandAllSections(): void {
    collapsedKeys.value = new Set()
  }

  // True (pre-window) count per section, so a collapsed/paginated divider can
  // still report its real total.
  const sectionTotals = computed(() => {
    const totals = new Map<string, number>()
    for (const s of groupedSections.value) totals.set(s.key, s.records.length)
    return totals
  })
  function sectionTotal(key: string): number {
    return sectionTotals.value.get(key) ?? 0
  }

  // ─── Infinite-scroll window over the grouped sections ──────
  const focusedCardIndexRef = computed(() => focusedCardIndex.value ?? -1)
  const {
    renderedCount,
    hasMore,
    bumpWindow,
    expandWindowToAll,
    resetCounter,
  } = useMatchesWindow(records, [sortOrder, groupBy], focusedCardIndexRef)

  // Slice groupedSections at renderedCount total rows. Headers are free; a
  // section over the budget keeps its first K rows; sections past the cap drop.
  const windowedSections = computed<GroupedSection[]>(() => {
    const cap = renderedCount.value
    const out: GroupedSection[] = []
    let used = 0
    let capReached = false
    for (const s of groupedSections.value) {
      if (collapsedKeys.value.has(s.key)) {
        out.push({ key: s.key, header: s.header, records: [] })
        continue
      }
      if (capReached) continue
      const remaining = cap - used
      if (s.records.length <= remaining) {
        out.push(s)
        used += s.records.length
      } else {
        out.push({ key: s.key, header: s.header, records: s.records.slice(0, remaining) })
        capReached = true
      }
    }
    return out
  })

  const leavesListRef = ref<HTMLUListElement | null>(null)
  // Either the leaf list's <li> sentinel or the data table's <tr> sentinel binds
  // here — only one renders per density; the single observer re-observes.
  const sentinelRef = ref<HTMLElement | null>(null)
  let sentinelObserver: IntersectionObserver | null = null

  // ─── Flat-mode row virtualization ──────────────────────────
  const leafRowHeight = ref(LEAF_ROW_HEIGHT_DEFAULT)
  const flatVirtualization = computed(() => groupBy.value === 'none')

  const flatVirtual = useVirtualWindow({
    items: sortedRecords,
    containerRef: leavesListRef,
    mode: 'window',
    itemHeight: LEAF_ROW_HEIGHT_DEFAULT,
    overscan: 8,
  })

  // Grouped: windowedSections (paginated). Flat: a single synthetic section
  // carrying only the virtualizer's visible slice.
  const renderSections = computed<GroupedSection[]>(() => {
    if (!flatVirtualization.value) return windowedSections.value
    return [{
      key: 'all',
      header: null,
      records: flatVirtual.visibleItems.value as MatchRecord[],
    }]
  })

  const flatTopSpacerHeight = computed(() => flatVirtualization.value ? flatVirtual.topSpacer.value : 0)
  const flatBottomSpacerHeight = computed(() => flatVirtualization.value ? flatVirtual.bottomSpacer.value : 0)

  // Re-measure row height after the first virtualized render so the window math
  // reflects the actual geometry (density modes + theme font-size overrides).
  function measureLeafHeight(): void {
    if (!flatVirtualization.value) return
    const el = leavesListRef.value?.querySelector<HTMLElement>('.leaf-row')
    if (!el) return
    const measured = Math.round(el.getBoundingClientRect().height) + 2 // +2 for flex gap
    if (measured > 20 && Math.abs(measured - leafRowHeight.value) > 1) {
      leafRowHeight.value = measured
    }
  }

  // On a virtualization toggle, reset the constant to the per-density baseline so
  // the first paint uses the right value before the measure catches up.
  watch([flatVirtualization, density], () => {
    leafRowHeight.value = density.value === 'compact' ? LEAF_ROW_HEIGHT_COMPACT : LEAF_ROW_HEIGHT_DEFAULT
  })

  // Auto-scroll an off-window focused row into view when j/k advances
  // focusedCardIndex past the rendered slice.
  watch(focusedCardIndex, async (idx) => {
    if (!flatVirtualization.value) return
    if (idx === undefined || idx < 0) return
    const list = leavesListRef.value
    if (!list) return
    const rowHeight = leafRowHeight.value
    const listTop = list.getBoundingClientRect().top + window.scrollY
    const rowTop = listTop + idx * rowHeight
    const viewTop = window.scrollY
    const viewBottom = window.scrollY + window.innerHeight
    if (rowTop >= viewTop + 80 && rowTop + rowHeight <= viewBottom - 80) return
    const target = rowTop - window.innerHeight / 3
    window.scrollTo({ top: Math.max(0, target), behavior: 'auto' })
  })

  // Reset → scroll the list back to the top. In flat virtualization the list is
  // in normal document flow, so scroll the document up to the list's top instead
  // — but only when the user is already scrolled into it.
  watch(resetCounter, () => {
    if (flatVirtualization.value) {
      const list = leavesListRef.value
      if (list) {
        const top = list.getBoundingClientRect().top + window.scrollY
        if (window.scrollY > top - 80) {
          window.scrollTo({ top: Math.max(0, top - 80), behavior: 'auto' })
        }
      }
      return
    }
    leavesListRef.value?.scrollTo({ top: 0, behavior: 'auto' })
  })

  // Index every visible leaf-row by its position in the narrowed set so j/k nav
  // (which walks the same set) can target the matching row via data-card-index.
  const narrowedIndexByKey = computed(() => {
    const m = new Map<string, number>()
    records.value.forEach((r, i) => m.set(r.match_key, i))
    return m
  })

  onMounted(() => {
    // IntersectionObserver for the infinite-scroll sentinel. It only mounts while
    // hasMore is true, so watch the ref and re-observe on (re)mount. rootMargin
    // pre-loads the next page just before the user reaches the tail.
    watch(sentinelRef, (el, prev) => {
      if (prev && sentinelObserver) sentinelObserver.unobserve(prev)
      if (!el) return
      if (!sentinelObserver) {
        sentinelObserver = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.isIntersecting) bumpWindow()
            }
          },
          { root: null, rootMargin: '200px' },
        )
      }
      sentinelObserver.observe(el)
    }, { immediate: true })

    void nextTick().then(measureLeafHeight)
    watch(
      [() => flatVirtual.visibleItems.value.length, density],
      () => { void nextTick().then(measureLeafHeight) },
    )
  })

  onBeforeUnmount(() => {
    sentinelObserver?.disconnect()
    sentinelObserver = null
  })

  return {
    sortedRecords,
    renderSections,
    flatVirtualization,
    flatTopSpacerHeight,
    flatBottomSpacerHeight,
    leavesListRef,
    sentinelRef,
    isCollapsed,
    toggleSection,
    sectionTotal,
    narrowedIndexByKey,
    renderedCount,
    hasMore,
    resetCounter,
    expandWindowToAll,
    collapseAllSections,
    expandAllSections,
  }
}

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'

import type { MatchRecord } from '@/api'
import { useMatchesGroup, type GroupBy, type GroupedSection, type SortOrder } from '@/composables/matches/useMatchesGroup'
import { useMatchesWindow } from '@/composables/matches/useMatchesWindow'
import { useVirtualWindow } from '@/composables/matches/useVirtualWindow'
import type { Density } from '@/composables/matches/useDensity'
import type { useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'
import type { SearchClause } from '@/match/search-query'
import MatchLeafRow from '@/components/matches/MatchLeafRow.vue'
import MatchesTable from '@/components/matches/MatchesTable.vue'
import MatchesEmptySuggestions from '@/components/matches/MatchesEmptySuggestions.vue'

type NarrowApi = ReturnType<typeof useMatchesNarrow>

// The set's members list — the leaf-row <ul> (comfortable / compact
// density) or the sortable data <table> (data density), with flat-mode
// virtualization, grouped-mode infinite scroll, and the empty state.
//
// Extracted from MatchesView so the view stays orchestration: the
// parent owns the head controls (sort / group / density), the
// bulk-action bar, selection state, and the row-event handlers; this
// component owns the rendering + windowing, reflects parent state via
// props, and signals intent via emits. The parent calls `expandWindowToAll`
// (exposed) to render the whole list before its jump-to-undated scroll.
const props = defineProps<{
  // The narrowed record set, in App.vue's keyboard-nav order. Grouped +
  // sorted for display internally; data-card-index reflects THIS order.
  records: MatchRecord[]
  groupBy: GroupBy
  sortOrder: SortOrder
  density: Density
  // App.vue's j/k focus index — the matching row gets aria-current.
  focusedCardIndex?: number
  selectedKeys: Set<string>
  anchorKey: string | null
  searchClauses: SearchClause[]
  anyNarrow: boolean
  clauseExclusionCounts: NarrowApi['clauseExclusionCounts']['value']
}>()

const emit = defineEmits<{
  'open-match': [matchKey: string]
  'toggle-select': [matchKey: string]
  'row-context': [event: MouseEvent, matchKey: string]
  'hover-enter': [rec: MatchRecord, event: MouseEvent]
  'hover-move': [event: MouseEvent]
  'hover-leave': []
  'reset-narrow': []
  'export-csv': []
}>()

const records = toRef(props, 'records')
const groupBy = toRef(props, 'groupBy')
const sortOrder = toRef(props, 'sortOrder')

// ─── Sort + group via useMatchesGroup composable ───────────
const { sortedRecords, groupedSections } = useMatchesGroup(records, groupBy, sortOrder)

// ─── Collapsible group sections ────────────────────────────
//
// Only meaningful in grouped modes (flat 'none' has no dividers). A
// collapsed section keeps its header but renders zero rows and frees
// its share of the render budget so the rest of the list flows up.
// Keys are namespaced by the grouping value (a date key never collides
// with 'ocr_edited'), so the collapse memory survives a round-trip
// through other groupings. Session-scoped — a fresh load starts fully
// expanded.
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

// True (pre-window) record count per section, so a collapsed divider —
// whose rendered `records` is empty — can still report how many rows it
// hides, and an expanded-but-paginated divider shows its real total.
const sectionTotals = computed(() => {
  const totals = new Map<string, number>()
  for (const s of groupedSections.value) totals.set(s.key, s.records.length)
  return totals
})
function sectionTotal(key: string): number {
  return sectionTotals.value.get(key) ?? 0
}

// ─── Data-density table: per-column sort ──────────────────
// Data density is a flat spreadsheet — the active column header sorts the

// ─── Infinite-scroll window over the grouped sections ──────
//
// Renders only the first `renderedCount` rows; an
// IntersectionObserver sentinel below the rendered set bumps the
// window by another page when the user scrolls into it. Reset
// triggers (narrow change, sort change, group change, parse
// refresh) snap back to one page + scroll the list to top via
// the resetCounter watcher below.
const focusedCardIndexRef = computed(() => props.focusedCardIndex ?? -1)
const {
  renderedCount,
  hasMore,
  bumpWindow,
  expandWindowToAll,
  resetCounter,
} = useMatchesWindow(records, [sortOrder, groupBy], focusedCardIndexRef)

// Slice groupedSections at renderedCount total rows. Headers are
// free (they don't count toward the cap); a section that runs
// over the budget keeps only the first K rows; sections past the
// cap drop entirely so we don't render a dangling header.
const windowedSections = computed<GroupedSection[]>(() => {
  const cap = renderedCount.value
  const out: GroupedSection[] = []
  let used = 0
  let capReached = false
  for (const s of groupedSections.value) {
    // A collapsed section always shows its divider but renders no rows
    // and spends no budget, so collapsing a big group surfaces the
    // groups below it instead of paginating through hidden rows.
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

// IntersectionObserver wiring lives in onMounted / onBeforeUnmount
// below — keeps the DOM-touching concern co-located with the
// leavesListRef declaration.
const leavesListRef = ref<HTMLUListElement | null>(null)
// Either the leaf list's <li> sentinel or the data table's <tr>
// sentinel binds here — only one renders per density, and the single
// IntersectionObserver re-observes whichever mounts.
const sentinelRef   = ref<HTMLElement | null>(null)
let sentinelObserver: IntersectionObserver | null = null

// ─── Flat-mode row virtualization ──────────────────────────────
//
// When the user picks groupBy='none', the leaves list is one
// uniform-height stack of rows. We render only the slice currently
// in (or near) the viewport via useVirtualWindow; spacer divs
// above + below the slice hold the scroll height stable so the
// page scrollbar still represents the full corpus. Grouped modes
// keep the existing pagination — section-divider mixed-height
// rows would need a different model.
const LEAF_ROW_HEIGHT_DEFAULT = 58
const LEAF_ROW_HEIGHT_COMPACT = 38
const leafRowHeight = ref(LEAF_ROW_HEIGHT_DEFAULT)

const flatVirtualization = computed(() => props.groupBy === 'none')

const flatVirtual = useVirtualWindow({
  items:        sortedRecords,
  containerRef: leavesListRef,
  mode:         'window',
  itemHeight:   LEAF_ROW_HEIGHT_DEFAULT,
  overscan:     8,
})

// Render-time section list. Grouped: existing windowedSections
// (paginated). Flat: a single synthetic section carrying only the
// virtualizer's visible slice. The template iterates this shape
// either way so the leaf-row body stays in one place.
const renderSections = computed<GroupedSection[]>(() => {
  if (!flatVirtualization.value) return windowedSections.value
  return [{
    key:     'all',
    header:  null,
    records: flatVirtual.visibleItems.value as MatchRecord[],
  }]
})

// Spacer heights — non-zero only in flat virtualization.
const flatTopSpacerHeight    = computed(() => flatVirtualization.value ? flatVirtual.topSpacer.value    : 0)
const flatBottomSpacerHeight = computed(() => flatVirtualization.value ? flatVirtual.bottomSpacer.value : 0)

// Re-measure the row height after the first virtualized render so
// the math reflects the actual rendered geometry — density modes
// ship different row heights, and theme-level font-size overrides
// would otherwise leave us computing windows against a stale constant.
function measureLeafHeight(): void {
  if (!flatVirtualization.value) return
  const el = leavesListRef.value?.querySelector<HTMLElement>('.leaf-row')
  if (!el) return
  const measured = Math.round(el.getBoundingClientRect().height) + 2 // +2 for flex gap
  if (measured > 20 && Math.abs(measured - leafRowHeight.value) > 1) {
    leafRowHeight.value = measured
  }
}

// When the user toggles between virtualization-on and -off, reset
// the constant to a sensible per-density baseline so the first paint
// after the toggle uses the right value before the measure catches up.
watch([flatVirtualization, () => props.density], () => {
  leafRowHeight.value = props.density === 'compact' ? LEAF_ROW_HEIGHT_COMPACT : LEAF_ROW_HEIGHT_DEFAULT
})

// ─── Data-density table renderer ───────────────────────────────
//
// The `data` density swaps the leaf-row <ul> for a real <table>
// (sortable column headers + MatchTableRow rows): a flat spreadsheet
// where the active column header sorts the WHOLE table, virtualized
// through its own window. Table rows are far shorter than leaf rows, so
// this needs a dedicated itemHeight + spacer <tr>s rather than reusing
// the leaf virtualizer.
//

// Auto-scroll an off-window focused row into view when App.vue's
// j/k keyboard nav advances focusedCardIndex past the rendered slice.
watch(() => props.focusedCardIndex, async (idx) => {
  if (!flatVirtualization.value) return
  if (idx === undefined || idx < 0) return
  const list = leavesListRef.value
  if (!list) return
  const rowHeight = leafRowHeight.value
  const listTop = list.getBoundingClientRect().top + window.scrollY
  const rowTop  = listTop + idx * rowHeight
  const viewTop    = window.scrollY
  const viewBottom = window.scrollY + window.innerHeight
  // Generous slack — only scroll when the row would otherwise be
  // entirely above or below the viewport.
  if (rowTop >= viewTop + 80 && rowTop + rowHeight <= viewBottom - 80) return
  const target = rowTop - window.innerHeight / 3
  window.scrollTo({ top: Math.max(0, target), behavior: 'auto' })
})

// Reset → scroll the leaves list back to the top. In flat
// virtualization the list is in normal document flow, so resetting
// the list's own scrollTop is a no-op — scroll the document up to the
// list's top instead, with a small offset for the chrome above.
watch(resetCounter, () => {
  if (flatVirtualization.value) {
    const list = leavesListRef.value
    if (list) {
      const top = list.getBoundingClientRect().top + window.scrollY
      // Only pull the document up to the list when the user is already
      // scrolled into it. A reset fired while they're ABOVE the list —
      // drilling the dossier heatmap, clicking a Campaign Log day — must
      // not yank them down to the list top.
      if (window.scrollY > top - 80) {
        window.scrollTo({ top: Math.max(0, top - 80), behavior: 'auto' })
      }
    }
    return
  }
  leavesListRef.value?.scrollTo({ top: 0, behavior: 'auto' })
})

// Index every visible leaf-row by its position in the narrowed set so
// App.vue's j/k keyboard nav (which walks the same set) can target the
// matching row via `data-card-index`.
const narrowedIndexByKey = computed(() => {
  const m = new Map<string, number>()
  records.value.forEach((r, i) => m.set(r.match_key, i))
  return m
})

onMounted(() => {
  // IntersectionObserver for the infinite-scroll sentinel. The
  // sentinel only mounts while `hasMore` is true, so we watch the ref
  // and re-observe on (re)mount. rootMargin pre-loads the next page
  // just before the user reaches the tail.
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

  // Measure leaf-row height after first paint, then re-measure when the
  // rendered slice changes (density swap, narrow apply shrinking to a
  // single row) so the constant stays calibrated.
  void nextTick().then(measureLeafHeight)
  watch(
    [() => flatVirtual.visibleItems.value.length, () => props.density],
    () => { void nextTick().then(measureLeafHeight) },
  )
})

onBeforeUnmount(() => {
  sentinelObserver?.disconnect()
  sentinelObserver = null
})

defineExpose({ expandWindowToAll })
</script>

<template>
  <ul
    v-if="density !== 'data' && sortedRecords.length"
    ref="leavesListRef"
    class="leaves-list"
    :class="`density-${density}`"
    role="list"
  >
    <!-- Virtualization spacers. Non-zero only when groupBy='none';
       height equals the count of unmounted rows above (or below) the
       visible slice times the measured row height. Holds the scrollbar
       in place so the document still scrolls through every row even
       though most aren't in the DOM. -->
    <li
      v-if="flatTopSpacerHeight > 0"
      class="leaves-virtual-spacer"
      aria-hidden="true"
      :style="{ height: flatTopSpacerHeight + 'px' }"
      data-virt-top-spacer
    />
    <template v-for="section in renderSections" :key="section.key">
      <li v-if="section.header" class="section-divider" :data-section-key="section.key">
        <button
          type="button"
          class="sd-toggle"
          :aria-expanded="!isCollapsed(section.key)"
          :aria-label="`${isCollapsed(section.key) ? 'Expand' : 'Collapse'} ${section.header} group`"
          :data-section-toggle="section.key"
          @click="toggleSection(section.key)"
        >
          <span class="sd-chevron" :class="{ 'sd-chevron-collapsed': isCollapsed(section.key) }" aria-hidden="true">▾</span>
          <span class="sd-label">{{ section.header }}</span>
          <span class="sd-count">{{ sectionTotal(section.key) }}</span>
        </button>
        <span class="sd-line" aria-hidden="true" />
      </li>
      <template v-if="!isCollapsed(section.key)">
        <MatchLeafRow
          v-for="rec in section.records"
          :key="rec.match_key"
          :rec="rec"
          :card-index="narrowedIndexByKey.get(rec.match_key) ?? -1"
          :focused-card-index="props.focusedCardIndex"
          :selected="selectedKeys.has(rec.match_key)"
          :has-selection="selectedKeys.size > 0"
          :is-anchor="rec.match_key === anchorKey"
          :search-clauses="searchClauses"
          @open-match="emit('open-match', $event)"
          @toggle-select="emit('toggle-select', $event)"
          @row-context="(e, k) => emit('row-context', e, k)"
          @hover-enter="(r, e) => emit('hover-enter', r, e)"
          @hover-move="(e) => emit('hover-move', e)"
          @hover-leave="emit('hover-leave')"
        />
      </template>
    </template>
    <!-- Bottom virtualization spacer — counterpart to flatTopSpacerHeight. -->
    <li
      v-if="flatBottomSpacerHeight > 0"
      class="leaves-virtual-spacer"
      aria-hidden="true"
      :style="{ height: flatBottomSpacerHeight + 'px' }"
      data-virt-bottom-spacer
    />
    <!-- Infinite-scroll sentinel. Observed by an IntersectionObserver
       wired in onMounted; entering the viewport bumps the window by
       another page. Skipped when flat-mode virtualization is active. -->
    <li
      v-if="hasMore && !flatVirtualization"
      ref="sentinelRef"
      class="leaves-sentinel"
      aria-hidden="true"
      data-testid="leaves-sentinel"
    />
    <!-- Honest count for screen readers AND sighted users. -->
    <li
      class="leaves-foot"
      role="status"
      aria-live="polite"
      data-testid="leaves-foot"
    >
      <span v-if="hasMore && !flatVirtualization">
        Showing {{ renderedCount }} of {{ sortedRecords.length }} matches
      </span>
      <span v-else class="leaves-foot-end">
        <span class="leaves-foot-rule" aria-hidden="true" />
        End · {{ sortedRecords.length }}
        {{ sortedRecords.length === 1 ? 'match' : 'matches' }}
        <span class="leaves-foot-rule" aria-hidden="true" />
      </span>
    </li>
  </ul>

  <!-- Data density — the full narrowed set as a sortable, virtualized table. -->
  <MatchesTable
    v-else-if="density === 'data' && sortedRecords.length"
    :records="sortedRecords"
    :reset-counter="resetCounter"
    :focused-card-index="focusedCardIndex"
    :selected-keys="selectedKeys"
    :anchor-key="anchorKey"
    :search-clauses="searchClauses"
    :narrowed-index-by-key="narrowedIndexByKey"
    @open-match="(k) => emit('open-match', k)"
    @toggle-select="(k) => emit('toggle-select', k)"
    @row-context="(e, k) => emit('row-context', e, k)"
    @hover-enter="(r, e) => emit('hover-enter', r, e)"
    @hover-move="(e) => emit('hover-move', e)"
    @hover-leave="emit('hover-leave')"
    @export-csv="emit('export-csv')"
  />

  <p v-else class="leaves-empty">
    No matches in this set.
    <button v-if="anyNarrow" class="leaves-empty-btn" @click="emit('reset-narrow')">
      Clear narrowing
    </button>
    <MatchesEmptySuggestions
      v-if="anyNarrow"
      :suggestions="clauseExclusionCounts.slice(0, 2)"
    />
  </p>
</template>

<style scoped>
.leaves-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Flat-mode virtualization spacers. Pure height — no border,
   no background, no content. Their job is to make the
   scroll-bar represent the full corpus while only the in-
   viewport slice of leaf-rows is in the DOM. */
.leaves-virtual-spacer {
  list-style: none;
  flex-shrink: 0;
  pointer-events: none;
}

.section-divider {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0 0.15rem;
}
.section-divider:first-child { padding-top: 0.1rem; }

/* The header doubles as a disclosure toggle — click (or Enter/Space)
   collapses the group to just this row, click again re-expands. */
.sd-toggle {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.12rem 0.45rem 0.12rem 0.25rem;
  margin: 0;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text-faint);
  border-radius: 3px;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}

.sd-toggle:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border-color: var(--accent-soft, var(--border));
  color: var(--text);
}

.sd-toggle:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 28%, transparent);
}

.sd-chevron {
  display: inline-block;
  font-size: 0.7rem;
  line-height: 1;
  color: var(--accent);
  transition: transform 160ms ease;
}
.sd-chevron-collapsed { transform: rotate(-90deg); }

@media (prefers-reduced-motion: reduce) {
  .sd-chevron { transition: none; }
}

.sd-line {
  height: 1px;
  background: linear-gradient(90deg, var(--border) 0%, var(--border) 70%, transparent);
}
.sd-label { color: var(--accent); }

.sd-count {
  font-family: var(--mono);
  font-size: 0.56rem;
  letter-spacing: 0.1em;
  color: var(--text-faint);
  padding: 0.05rem 0.35rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
}


/* Compact density — tightens vertical rhythm so more rows fit on
   screen without going full data-table mode. Only the spacing and
   strip height change; grid template, fonts, and result-chip
   geometry stay so the eye reads rows the same way. */
.leaves-list.density-compact :deep(.leaf-row) {
  padding: 0.3rem 0.85rem;
  gap: 0.65rem;
}
.leaves-list.density-compact :deep(.leaf-strip) { height: 26px; }


/* ─── Data density — the sortable match <table> ───────────────────
   A real semantic table replaces the leaf-row <ul> when density is
   `data`: hairline rows, a sticky sortable header, monospace cells.
   Per-row + per-cell styling lives in MatchTableRow.vue (scoped to
   its own <tr>); these rules own the table frame + header. */

/* Bounded data-grid scroll pane — vertical (max-height) + horizontal
   (the table's min-width) scrolling in one box, so the uppercase header
   stays pinned (sticky to THIS pane) while wide rows scroll sideways. */


.leaves-empty {
  margin: 0;
  text-align: center;
  font-family: var(--mono);
  color: var(--text-dim);
  padding: 1.5rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  align-items: center;
}

/* Infinite-scroll sentinel — zero-height marker observed by the
   IntersectionObserver. Doesn't render anything visible; the
   visual "you've reached more rows" affordance is the foot below it. */
.leaves-sentinel {
  height: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* "Showing N of M" foot. Visually subdued — same tone as the
   empty-state copy — so it sits below the rows without competing
   with the result chips above. */
.leaves-foot {
  margin: 0;
  padding: 0.9rem 0 1.1rem;
  text-align: center;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-dim);
  list-style: none;
}

/* End-of-results decoration. Em-dash rules flank the final count
   so the user gets a clear visual boundary instead of empty space
   below the last row. Only renders on the "no-more-to-load" state;
   the progressive "showing X of Y" line stays plain. */
.leaves-foot-end {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
}

.leaves-foot-rule {
  display: inline-block;
  width: 1.8rem;
  height: 1px;
  background: currentcolor;
  opacity: 0.5;
}

.leaves-empty-btn {
  appearance: none;
  background: transparent;
  border: 1px solid var(--accent);
  border-radius: 2px;
  padding: 0.35rem 0.85rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
  cursor: pointer;
  font-weight: 700;
}
.leaves-empty-btn:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }
</style>

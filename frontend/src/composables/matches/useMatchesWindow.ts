import { computed, ref, watch, type ComputedRef, type Ref, type WatchSource } from 'vue'
import type { MatchRecord } from '@/api-client'

// Client-side windowing for the Matches leaves list. Renders only
// the first `pageSize` rows of the narrowed/sorted/grouped set; an
// IntersectionObserver sentinel in MatchesView expands the window
// by `pageSize` more when the user scrolls into the tail.
//
// Why client-side and not server-side pagination: server-side
// `GET /api/v1/matches?limit=&cursor=` exists, but the returned
// array is unsorted + unfiltered — server-side sort + filter
// pushdown would be the prerequisite for real HTTP paging, and
// the dossier still needs the full corpus to compute aggregates.
// Windowing the in-memory narrowed set sidesteps every one of
// those.
//
// Reset triggers (filter change, sort change, group change, parse
// refresh) snap `renderedCount` back to `pageSize` and bump
// `resetCounter` so the consumer can scroll its list back to top.
//
// Keyboard nav: if `focusedCardIndex` moves past the current
// window (e.g. j-key from row 19 to row 20), the composable
// expands the window until row 20 is in scope. App.vue's
// `focusCardByRenderedDelta` then finds the freshly-mounted
// element via `data-card-index`.

export const DEFAULT_PAGE_SIZE = 20

export interface UseMatchesWindowReturn {
  // Highest index (exclusive) currently rendered. Templates slice
  // their grouped sections against this so headers + rows stay
  // aligned.
  renderedCount: Ref<number>
  // True while more rows exist beyond `renderedCount` — drives
  // the sentinel + "Showing N of M" foot.
  hasMore: ComputedRef<boolean>
  // Add another page to the window. Clamps at the corpus length so
  // a sentinel-fire-twice race doesn't overshoot.
  bumpWindow: () => void
  // Expand the window all the way to the corpus end in one step.
  // Called by the "jump to undated" affordance, where landing on a
  // section that lives past the current window means bump-by-page
  // would either need to fire dozens of times or scroll-and-wait
  // for the sentinel. Skipping straight to renderedCount = total
  // costs one render but lets the section divider land in the DOM
  // before the scrollIntoView call.
  expandWindowToAll: () => void
  // Expand until `idx` is in scope. Called by the focused-card
  // watcher so keyboard nav can land on rows the user can't see.
  ensureIndexVisible: (idx: number) => void
  // Force the window back to one page. Filter/sort/group changes
  // call this; the watcher does too. Public so tests + a future
  // "Reset view" affordance can call it directly.
  reset: () => void
  // Increments on every reset. MatchesView watches it to scroll
  // the leaves list back to the top — keeps the scrolling
  // concern in the view (where the list ref lives) without making
  // the composable DOM-aware.
  resetCounter: Ref<number>
}

export function useMatchesWindow(
  narrowedRecords: Readonly<Ref<MatchRecord[]>>,
  resetTriggers: WatchSource<unknown>[] = [],
  focusedCardIndex: Readonly<Ref<number>>,
  pageSize: number = DEFAULT_PAGE_SIZE,
): UseMatchesWindowReturn {
  const renderedCount = ref(pageSize)
  const resetCounter = ref(0)

  function reset(): void {
    renderedCount.value = pageSize
    resetCounter.value++
  }

  function bumpWindow(): void {
    const total = narrowedRecords.value.length
    renderedCount.value = Math.min(renderedCount.value + pageSize, total)
  }

  function expandWindowToAll(): void {
    renderedCount.value = narrowedRecords.value.length
  }

  function ensureIndexVisible(idx: number): void {
    if (idx < 0) return
    const total = narrowedRecords.value.length
    // Cap the loop at total to defend against an out-of-range
    // index (shouldn't happen — narrowedRecords is the source of
    // truth for idx — but cheap to guard).
    while (renderedCount.value <= idx && renderedCount.value < total) {
      renderedCount.value = Math.min(renderedCount.value + pageSize, total)
    }
  }

  // Reset on any of the configured triggers — narrowed-set changes
  // (filter / new-parse refresh) AND view triggers the caller
  // passes in (sort order, group-by). Using a single watch keeps
  // the reset atomic so resetCounter only increments once per
  // user-perceptible reason.
  watch([narrowedRecords, ...resetTriggers], reset, { flush: 'post' })

  watch(focusedCardIndex, (idx) => {
    if (typeof idx === 'number' && idx >= 0) ensureIndexVisible(idx)
  })

  const hasMore = computed(() => renderedCount.value < narrowedRecords.value.length)

  return { renderedCount, hasMore, bumpWindow, expandWindowToAll, ensureIndexVisible, reset, resetCounter }
}

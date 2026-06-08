import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue'

// useVirtualWindow keeps a long, flat list snappy by rendering only
// the rows currently in (or near) the scroll-container's viewport.
// Other rows are accounted for via two spacer divs that hold the
// scroll height stable; the scrollbar moves naturally even though
// 95% of the list isn't in the DOM.
//
// Scope:
//   - Fixed-height rows only. The composable does not measure rows;
//     callers pass `itemHeight` and the math assumes uniformity.
//     For mixed-height lists (e.g. section dividers interleaved
//     with leaves) wrap with a pre-flatten pass that converts every
//     row to a uniform shape, or keep the existing pagination —
//     this composable is the simple-case fast path.
//   - One vertical scroll container per instance. Horizontal scroll
//     + nested scroll containers aren't considered.
//
// Numerical contract:
//   visibleStart = floor(scrollTop / itemHeight)
//   visibleEnd   = ceil((scrollTop + clientHeight) / itemHeight)
//   start        = max(0, visibleStart - overscan)
//   end          = min(items.length, visibleEnd + overscan)
//   topSpacer    = start * itemHeight
//   bottomSpacer = (items.length - end) * itemHeight
//
// Overscan defaults to 5 — enough that a fast scroll doesn't reveal
// blank space below the unmounted-but-soon-visible rows, small
// enough that the DOM stays tight on small viewports.

export interface UseVirtualWindowOptions<T> {
  // Reactive list. Re-renders the window when the list reference
  // changes (sort, narrow, etc.).
  items: Ref<readonly T[]>
  // Pixel height of one row. Single number — uniform-height
  // assumption baked in.
  itemHeight: number
  // The scrollable container the rows live inside. The composable
  // reads .clientHeight and .scrollTop; it never writes either.
  containerRef: Ref<HTMLElement | null>
  // Rows above + below the strict viewport that stay mounted so a
  // fast scroll doesn't reveal blank rows. Default 5.
  overscan?: number
}

export interface UseVirtualWindowReturn<T> {
  // Slice of `items` currently rendered.
  visibleItems: ComputedRef<readonly T[]>
  // Pixel height of the empty spacer above the rendered slice.
  topSpacer: ComputedRef<number>
  // Pixel height of the empty spacer below the rendered slice.
  bottomSpacer: ComputedRef<number>
  // Inclusive start index of the rendered slice in `items`.
  startIndex: ComputedRef<number>
  // Exclusive end index of the rendered slice in `items`.
  endIndex: ComputedRef<number>
}

export function useVirtualWindow<T>(
  opts: UseVirtualWindowOptions<T>,
): UseVirtualWindowReturn<T> {
  const { items, itemHeight, containerRef } = opts
  const overscan = opts.overscan ?? 5

  // Live geometry from the container. Tracked as plain refs (not
  // computed) because they update via the scroll + resize handlers
  // below, not from any other reactive source.
  const scrollTop = ref(0)
  const clientHeight = ref(0)

  // Single RAF guard to coalesce scroll-event spam — multiple
  // 'scroll' events inside one frame collapse into one geometry
  // read.
  let rafHandle = 0
  function syncGeometry(): void {
    rafHandle = 0
    const el = containerRef.value
    if (!el) return
    scrollTop.value = el.scrollTop
    clientHeight.value = el.clientHeight
  }
  function onScroll(): void {
    if (rafHandle !== 0) return
    rafHandle = requestAnimationFrame(syncGeometry)
  }

  // ResizeObserver tracks the container itself — the viewport
  // changes when the user resizes the window, opens a side panel,
  // or the dossier height shifts above. window.resize alone misses
  // those.
  let resizeObserver: ResizeObserver | null = null

  function attach(el: HTMLElement): void {
    el.addEventListener('scroll', onScroll, { passive: true })
    try {
      resizeObserver = new ResizeObserver(syncGeometry)
      resizeObserver.observe(el)
    } catch (_) {
      // ResizeObserver missing (very old envs / SSR) — fall back to
      // window resize. The container itself still gets the scroll
      // listener, so most cases work.
      window.addEventListener('resize', syncGeometry)
    }
    // Initial read so the first render has a real window, not just
    // overscan-only rows.
    syncGeometry()
  }

  function detach(el: HTMLElement | null): void {
    if (el) el.removeEventListener('scroll', onScroll)
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    } else {
      window.removeEventListener('resize', syncGeometry)
    }
    if (rafHandle !== 0) {
      cancelAnimationFrame(rafHandle)
      rafHandle = 0
    }
  }

  // Re-attach when the container ref swaps (e.g. caller v-if's the
  // container in/out).
  watch(containerRef, (next, prev) => {
    if (prev) detach(prev)
    if (next) attach(next)
  })

  onMounted(() => {
    if (containerRef.value) attach(containerRef.value)
  })

  onBeforeUnmount(() => {
    detach(containerRef.value)
  })

  // Reset scroll when the items reference changes (narrow apply,
  // sort flip, etc.) — without this, the previous scrollTop would
  // point at an item-index that no longer exists, and the visible
  // window would be empty until the user scrolls.
  watch(items, () => {
    const el = containerRef.value
    if (el && el.scrollTop !== 0) {
      el.scrollTop = 0
      syncGeometry()
    }
  })

  const startIndex = computed(() => {
    if (clientHeight.value === 0) return 0
    const raw = Math.floor(scrollTop.value / itemHeight) - overscan
    return Math.max(0, raw)
  })

  const endIndex = computed(() => {
    if (clientHeight.value === 0) {
      // Before mount or in an unmeasurable container, render an
      // overscan-sized batch so the first paint isn't empty.
      return Math.min(items.value.length, 2 * overscan)
    }
    const visibleEnd = Math.ceil((scrollTop.value + clientHeight.value) / itemHeight)
    return Math.min(items.value.length, visibleEnd + overscan)
  })

  const visibleItems = computed(() => items.value.slice(startIndex.value, endIndex.value))
  const topSpacer    = computed(() => startIndex.value * itemHeight)
  const bottomSpacer = computed(() => Math.max(0, items.value.length - endIndex.value) * itemHeight)

  return { visibleItems, topSpacer, bottomSpacer, startIndex, endIndex }
}

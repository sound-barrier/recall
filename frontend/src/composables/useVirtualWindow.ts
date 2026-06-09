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
// the rows currently in (or near) the scrolling viewport. Other rows
// are accounted for via two spacer divs that hold the scroll height
// stable; the scrollbar moves naturally even though most of the list
// isn't in the DOM.
//
// Two scroll sources are supported:
//
//   1. `mode: 'container'` (default) — the composable tracks
//      `containerRef.scrollTop` + `containerRef.clientHeight`. The
//      caller has wrapped the list in an `overflow-y: auto` element
//      that owns its own scroll. Easiest math but it changes the
//      UX (page chrome stays put while the list scrolls).
//
//   2. `mode: 'window'` — the document itself scrolls; the list
//      lives in normal flow. The composable reads
//      `window.scrollY` + `window.innerHeight`, subtracts the
//      list's `containerRef.getBoundingClientRect().top` to get
//      the list-relative scrollTop, and clips clientHeight against
//      the actual visible portion of the list. Preserves the
//      whole-page-scrolls UX while still virtualizing the rows.
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
  // The host element the rows live inside. In `mode: 'container'`
  // this is the scroll container itself. In `mode: 'window'` it's
  // the list element in normal flow — the composable uses it
  // only to compute the list's offset within the document.
  containerRef: Ref<HTMLElement | null>
  // Where the scroll signal comes from.
  //   'container' — read .scrollTop + .clientHeight (default).
  //   'window'    — read window.scrollY + window.innerHeight and
  //                 subtract the list's offsetTop.
  mode?: 'container' | 'window'
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
  const mode = opts.mode ?? 'container'

  // Live geometry. Tracked as plain refs (not computed) because they
  // update via the scroll + resize handlers below, not from any
  // other reactive source. In window mode these are LIST-relative —
  // scrollTop is how many pixels of the list have scrolled above
  // the viewport top, clientHeight is how many pixels of the list
  // are currently inside the viewport.
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
    if (mode === 'container') {
      scrollTop.value = el.scrollTop
      clientHeight.value = el.clientHeight
      return
    }
    // Window mode: compute list-relative scrollTop + clientHeight
    // from the list's position in the viewport.
    //   - getBoundingClientRect().top is the list's offset from the
    //     viewport top (negative when scrolled past).
    //   - List-relative scrollTop = -top when the list is scrolled
    //     past the top, 0 otherwise.
    //   - Visible clientHeight = min(viewport, list bottom inside
    //     viewport) - top portion above viewport.
    const rect = el.getBoundingClientRect()
    const viewH = window.innerHeight
    const topAbove   = Math.max(0, -rect.top)
    const bottomBelow = Math.max(0, rect.bottom - viewH)
    scrollTop.value = topAbove
    clientHeight.value = Math.max(0, rect.height - topAbove - bottomBelow)
  }
  function onScroll(): void {
    if (rafHandle !== 0) return
    rafHandle = requestAnimationFrame(syncGeometry)
  }

  // ResizeObserver tracks the container — viewport changes when
  // the dossier height shifts above (KPI value reflow, narrow chip
  // row growing taller). window.resize alone misses those.
  let resizeObserver: ResizeObserver | null = null

  function attach(el: HTMLElement): void {
    if (mode === 'container') {
      el.addEventListener('scroll', onScroll, { passive: true })
    } else {
      window.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('resize', onScroll, { passive: true })
    }
    try {
      resizeObserver = new ResizeObserver(syncGeometry)
      resizeObserver.observe(el)
    } catch (_) {
      // ResizeObserver missing (very old envs / SSR) — fall back to
      // window resize.
      if (mode === 'container') window.addEventListener('resize', syncGeometry)
    }
    // Initial read so the first render has a real window, not just
    // overscan-only rows.
    syncGeometry()
  }

  function detach(el: HTMLElement | null): void {
    if (mode === 'container') {
      if (el) el.removeEventListener('scroll', onScroll)
    } else {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    } else if (mode === 'container') {
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
  // window would be empty until the user scrolls. In container mode
  // we own the scrollTop and reset it directly; in window mode the
  // page scroll is shared, so we delegate the "scroll back to the
  // list" decision to the caller (consumers like MatchesView
  // already drive the list-reset scroll via their own resetCounter
  // watcher), and just re-read geometry so the window math catches
  // up with the new item count.
  watch(items, () => {
    const el = containerRef.value
    if (!el) return
    if (mode === 'container' && el.scrollTop !== 0) {
      el.scrollTop = 0
    }
    syncGeometry()
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

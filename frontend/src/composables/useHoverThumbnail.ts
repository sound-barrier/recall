import { ref, computed } from 'vue'

// Cursor-anchored hover-preview thumbnail shared by the two surfaces that
// show a floating screenshot on row hover — the Ignored-files panel and the
// Unknown-maps view. Tracks which row is hovered + its preview src and keeps
// a viewport-clamped position; each consumer renders its own Teleport'd
// <img> off `showThumb` / `hoveredSrc` / `thumbX|Y`, with its own scoped CSS.
//
// `isVisible` gates the thumb off when the host panel/view is closed mid-
// hover (mouseleave never fires if the host unmounts under the cursor).
const THUMB_W = 360
const THUMB_H = 203
const CURSOR_GAP = 18

export function useHoverThumbnail(opts: {
  isVisible: () => boolean
  srcFor: (key: string) => string
  // Optional per-key gate (e.g. don't peek a row that's selected). When it
  // returns false for the hovered key, the thumb stays hidden.
  canShow?: (key: string) => boolean
}) {
  const hoveredKey = ref<string | null>(null)
  const hoveredSrc = ref('')
  const thumbX = ref(0)
  const thumbY = ref(0)

  // Anchor the thumb below-right of the cursor, edge-flipping
  // horizontally / vertically so it never clips against the viewport.
  function updatePosition(e: MouseEvent) {
    let x = e.clientX + CURSOR_GAP
    let y = e.clientY + CURSOR_GAP
    if (typeof window !== 'undefined') {
      const vw = window.innerWidth
      const vh = window.innerHeight
      if (x + THUMB_W + CURSOR_GAP > vw) x = e.clientX - THUMB_W - CURSOR_GAP
      if (y + THUMB_H + CURSOR_GAP > vh) y = e.clientY - THUMB_H - CURSOR_GAP
      if (x < CURSOR_GAP) x = CURSOR_GAP
      if (y < CURSOR_GAP) y = CURSOR_GAP
    }
    thumbX.value = x
    thumbY.value = y
  }

  function onHover(key: string, e: MouseEvent) {
    hoveredKey.value = key
    hoveredSrc.value = opts.srcFor(key)
    updatePosition(e)
  }

  function onMove(key: string, e: MouseEvent) {
    if (hoveredKey.value !== key) return
    updatePosition(e)
  }

  function onLeave() {
    hoveredKey.value = null
    hoveredSrc.value = ''
  }

  const showThumb = computed(() => {
    const key = hoveredKey.value
    if (!key || !hoveredSrc.value || !opts.isVisible()) return false
    return opts.canShow ? opts.canShow(key) : true
  })

  return { hoveredKey, hoveredSrc, thumbX, thumbY, showThumb, onHover, onMove, onLeave }
}

import { onBeforeUnmount, onMounted, ref } from 'vue'

// useScrollAffordance — small helper for window-scroll-driven UI like
// the "back to top" button on the Matches view. Wraps three concerns:
//
//   1. A boolean ref that flips true once the user has scrolled past
//      `threshold` px below the page top, false once they're above it.
//   2. A passive scroll listener coalesced through requestAnimationFrame
//      so a fast trackpad fling can't fire 60+ ref writes per second.
//   3. A `scrollToTop()` callback that uses smooth scrolling by default
//      and falls back to instant when the user has
//      `prefers-reduced-motion: reduce` set. The smooth-scroll behaviour
//      sits on the user agent (not CSS), so the global reduced-motion
//      media-query block in app.css doesn't reach it; this composable
//      checks the media query explicitly each call so a system-level
//      preference flip mid-session is honoured immediately.
//
// Extracted from MatchesView so the same shape can be reused by a
// future long-list view (e.g. a Hidden archive) and so the unit tests
// don't have to mount the entire view to verify the listener +
// threshold behaviour. Mirrors the per-helper composable pattern
// documented in frontend/CLAUDE.md.

export function useScrollAffordance(threshold = 400) {
  const isPastThreshold = ref(false)
  let raf = 0

  function onScroll() {
    if (raf) return
    raf = requestAnimationFrame(() => {
      isPastThreshold.value = window.scrollY > threshold
      raf = 0
    })
  }

  function scrollToTop() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  }

  onMounted(() => {
    window.addEventListener('scroll', onScroll, { passive: true })
    // Initial sync — handles deep-link routes that mount the view in
    // the middle of a long page so the button doesn't briefly mis-state
    // hidden when the user is already past the threshold.
    isPastThreshold.value = window.scrollY > threshold
  })

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', onScroll)
    if (raf) cancelAnimationFrame(raf)
  })

  return { isPastThreshold, scrollToTop }
}

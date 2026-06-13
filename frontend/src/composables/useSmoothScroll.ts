import { onBeforeUnmount, ref, type Ref } from 'vue'

// rAF-driven momentum scroller for a single scroll container. Plain
// `scrollBy({ behavior: 'smooth' })` cancels + restarts its animation on
// every call, so at OS key-repeat rate it stutters ("skipping"). Instead we
// hold one target position: each nudge moves the target, a single rAF loop
// tweens scrollTop toward it at 18% of the remaining gap per frame
// (~critically damped). Hold a key → the target outruns the position and the
// body glides; tap once → the loop runs ~25 frames then stops. Honours
// `prefers-reduced-motion: reduce` by snapping instantly.
//
// Extracted from MatchDetailPanel so any tall scroll surface can reuse the
// keyboard-scroll behaviour. The caller passes the element ref + drives it
// via nudgeScroll (relative) / setScrollAbsolute (Home/End).
export function useSmoothScroll(scrollEl: Ref<HTMLElement | null>) {
  const scrollTarget = ref(0)
  let scrollRAF = 0

  function tickScroll() {
    const el = scrollEl.value
    if (!el) { scrollRAF = 0; return }
    const delta = scrollTarget.value - el.scrollTop
    if (Math.abs(delta) < 0.5) {
      el.scrollTop = scrollTarget.value
      scrollRAF = 0
      return
    }
    el.scrollTop += delta * 0.18
    scrollRAF = requestAnimationFrame(tickScroll)
  }

  function commitScrollTarget(next: number) {
    const el = scrollEl.value
    if (!el) return
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    scrollTarget.value = Math.max(0, Math.min(max, next))
    // Reduced-motion: skip the tween.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      el.scrollTop = scrollTarget.value
      return
    }
    if (scrollRAF === 0) scrollRAF = requestAnimationFrame(tickScroll)
  }

  function nudgeScroll(deltaPx: number) {
    const el = scrollEl.value
    if (!el) return
    // First nudge after idle re-seeds the target from the actual
    // scrollTop — the user may have scrolled by wheel / drag since the
    // last keypress, and the next step should land relative to where
    // they are now (else the first arrow press yanks them back).
    if (scrollRAF === 0) scrollTarget.value = el.scrollTop
    commitScrollTarget(scrollTarget.value + deltaPx)
  }

  function setScrollAbsolute(next: number) {
    commitScrollTarget(next)
  }

  onBeforeUnmount(() => {
    if (scrollRAF !== 0) {
      cancelAnimationFrame(scrollRAF)
      scrollRAF = 0
    }
  })

  return { nudgeScroll, setScrollAbsolute }
}

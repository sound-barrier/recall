import { watch, onBeforeUnmount, type Ref } from 'vue'

// Locks page scroll while `active` is true; restores on false / unmount.
//
// The matches list (and the rest of the app) scrolls at the document /
// window level. App.vue already marks the background `inert` while a
// modal is open, but `inert` blocks focus/click/keyboard, NOT the mouse
// wheel — so wheeling over the background still scrolls the list behind
// an open overlay, and an anchored popover (e.g. the widget-config
// gear) scrolls out from under itself.
//
// Mechanism, two layers:
//   1. `overflow: hidden` on <html> + <body> hides the scrollbar and
//      stops scrollbar-drag. Programmatic scroll (`scrollIntoView`,
//      `scrollTo`) still works on an overflow:hidden element, which is
//      why the onboarding tour can drive itself between steps while
//      locked.
//   2. A non-passive `wheel` listener that preventDefaults any wheel
//      that would scroll the BACKGROUND (but lets the wheel through when
//      it lands inside an overlay's own scrollable area). This is the
//      load-bearing part: on WebKit (the macOS WKWebView the app ships
//      in) `overflow: hidden` alone doesn't drop the wheel delta — it
//      QUEUES a pending scroll that snaps in the instant the lock lifts,
//      so the page "jumps to where it would have scrolled" on close.
//      Killing the wheel at the event means nothing is ever queued.
//
// `overflow: hidden` preserves scrollTop, so closing restores the exact
// position. The vanishing scrollbar is compensated with body
// padding-right so content doesn't shift sideways (0 on macOS overlay
// scrollbars).
//
// Reference-counted at module scope so several overlays open at once
// (cheatsheet over the detail panel, lightbox over the ignored-files
// panel) keep the page locked until the LAST one closes. Each call holds
// at most one count and self-releases on unmount.

const WHEEL_OPTS: AddEventListenerOptions = { passive: false, capture: true }

let lockCount = 0
let prevHtmlOverflow = ''
let prevBodyOverflow = ''
let prevBodyPaddingRight = ''

// Block a wheel that would scroll the locked background. Walk from the
// event target up; if some ancestor can still scroll in the wheel's
// direction, let the event through so that inner scroll area moves.
// Otherwise the wheel would reach the (locked) root — cancel it.
function onWheel(e: WheelEvent): void {
  let node: HTMLElement | null = e.target instanceof HTMLElement ? e.target : null
  const html = document.documentElement
  while (node && node !== document.body && node !== html) {
    const oy = getComputedStyle(node).overflowY
    const scrollableY = (oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight
    if (scrollableY) {
      const atTop = node.scrollTop <= 0
      const atBottom = Math.ceil(node.scrollTop + node.clientHeight) >= node.scrollHeight
      if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) return
    }
    node = node.parentElement
  }
  e.preventDefault()
}

function acquire(): void {
  lockCount += 1
  if (lockCount > 1) return // already locked by an earlier holder
  const html = document.documentElement
  const body = document.body
  prevHtmlOverflow = html.style.overflow
  prevBodyOverflow = body.style.overflow
  prevBodyPaddingRight = body.style.paddingRight
  // Measure BEFORE hiding overflow — afterwards the scrollbar is gone
  // and the delta would read 0.
  const scrollbarW = window.innerWidth - html.clientWidth
  html.style.overflow = 'hidden'
  body.style.overflow = 'hidden'
  if (scrollbarW > 0) body.style.paddingRight = `${scrollbarW}px`
  window.addEventListener('wheel', onWheel, WHEEL_OPTS)
}

function releaseOne(): void {
  if (lockCount === 0) return
  lockCount -= 1
  if (lockCount > 0) return // still held by someone else
  document.documentElement.style.overflow = prevHtmlOverflow
  document.body.style.overflow = prevBodyOverflow
  document.body.style.paddingRight = prevBodyPaddingRight
  window.removeEventListener('wheel', onWheel, WHEEL_OPTS)
}

export function useScrollLock(active: Ref<boolean>): void {
  let held = false
  function sync(on: boolean): void {
    if (on && !held) {
      held = true
      acquire()
    } else if (!on && held) {
      held = false
      releaseOne()
    }
  }
  watch(active, sync, { immediate: true })
  onBeforeUnmount(() => {
    if (held) {
      held = false
      releaseOne()
    }
  })
}

// Test-only: clear the module counter + saved styles + the wheel
// listener so each test starts unlocked.
export function _resetScrollLockForTest(): void {
  if (lockCount > 0) window.removeEventListener('wheel', onWheel, WHEEL_OPTS)
  lockCount = 0
  prevHtmlOverflow = ''
  prevBodyOverflow = ''
  prevBodyPaddingRight = ''
}

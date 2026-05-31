import { nextTick, ref, type Ref } from 'vue'

// WAI-ARIA tab-pattern keyboard navigation for the masthead tablist.
//
// Left/Right cycle the tabs (wrap-around); Home/End jump to the ends.
// `h` / `l` work as vim-style aliases for Left/Right respectively,
// matching the pattern used everywhere else in the app
// (MatchDetailPanel prev/next match, MatchScreenshotLightbox
// prev/next screenshot). "Automatic activation" — focusing a tab
// also switches the view, same as a click. Focus moves to the newly-
// active tab on the next tick so the focus ring matches the selected
// state.
//
// Extracted from App.vue so the keyboard behaviour can be unit-tested
// in isolation and so adding a new tab doesn't require re-reading
// 800 lines of script-setup to find the order constant.

export const TAB_ORDER = ['settings', 'ingest', 'matches', 'analysis', 'unknown'] as const

export type TabId = typeof TAB_ORDER[number]

// useTabKeyboardNav optionally accepts a `tabs` ref so callers can
// hide tabs (e.g. dev-only Analysis tab on release builds) without
// the keyboard nav cycle landing on an invisible tab. Defaults to
// the full TAB_ORDER so existing call sites stay one-arg.
export function useTabKeyboardNav(
  view: Readonly<Ref<string>>,
  goToView: (next: TabId) => unknown | Promise<unknown>,
  tabs: Readonly<Ref<readonly TabId[]>> = ref(TAB_ORDER),
) {
  function onTabKeydown(e: KeyboardEvent) {
    const key = e.key
    // h/l act as vim aliases for ArrowLeft/ArrowRight. The tab buttons
    // are not editable, so absorbing single-letter keys is safe.
    const isLeft  = key === 'ArrowLeft'  || key === 'h'
    const isRight = key === 'ArrowRight' || key === 'l'
    if (!isLeft && !isRight && key !== 'Home' && key !== 'End') return
    e.preventDefault()
    const order = tabs.value
    if (order.length === 0) return
    const current = order.indexOf(view.value as TabId)
    if (current === -1) return
    let next = current
    if (isLeft)         next = (current - 1 + order.length) % order.length
    if (isRight)        next = (current + 1) % order.length
    if (key === 'Home') next = 0
    if (key === 'End')  next = order.length - 1
    const target = order[next]!
    void goToView(target)
    // Move focus from the now-inactive tab to the newly-active one
    // so the tab pattern's "automatic activation" matches the focus
    // ring on screen.
    nextTick(() => {
      const btn = document.getElementById(`tab-${target}`)
      btn?.focus()
    })
  }

  // Skip-link target. The native href="#main-content" works in most
  // browsers, but some don't move focus to the target on hash
  // navigation — only scroll. Explicitly focus the <main> for
  // keyboard parity.
  function focusMain(e: MouseEvent) {
    e.preventDefault()
    const main = document.getElementById('main-content')
    if (main) main.focus({ preventScroll: false })
  }

  return { onTabKeydown, focusMain, TAB_ORDER }
}

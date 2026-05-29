import { nextTick, type Ref } from 'vue'

// WAI-ARIA tab-pattern keyboard navigation for the masthead tablist.
//
// Left/Right cycle the tabs (wrap-around); Home/End jump to the ends.
// "Automatic activation" — focusing a tab also switches the view,
// same as a click. Focus moves to the newly-active tab on the next
// tick so the focus ring matches the selected state.
//
// Extracted from App.vue so the keyboard behaviour can be unit-tested
// in isolation and so adding a new tab doesn't require re-reading
// 800 lines of script-setup to find the order constant.

export const TAB_ORDER = ['settings', 'ingest', 'matches', 'analysis', 'unknown'] as const

export type TabId = typeof TAB_ORDER[number]

export function useTabKeyboardNav(
  view: Readonly<Ref<string>>,
  goToView: (next: TabId) => unknown | Promise<unknown>,
) {
  function onTabKeydown(e: KeyboardEvent) {
    const key = e.key
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return
    e.preventDefault()
    const current = TAB_ORDER.indexOf(view.value as TabId)
    if (current === -1) return
    let next = current
    if (key === 'ArrowLeft')  next = (current - 1 + TAB_ORDER.length) % TAB_ORDER.length
    if (key === 'ArrowRight') next = (current + 1) % TAB_ORDER.length
    if (key === 'Home')       next = 0
    if (key === 'End')        next = TAB_ORDER.length - 1
    const target = TAB_ORDER[next]!
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

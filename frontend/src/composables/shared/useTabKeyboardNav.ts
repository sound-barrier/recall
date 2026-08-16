import { nextTick, type Ref } from 'vue'

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
// Extracted from App.vue so the keyboard behavior can be unit-tested
// in isolation and so adding a new tab doesn't require re-reading
// 800 lines of script-setup to find the order constant.

export const TAB_ORDER = ['settings', 'ingest', 'matches', 'unknown', 'compare', 'elo'] as const

export type TabId = typeof TAB_ORDER[number]

// Every surface App can show. The film room is a VIEW but not a TAB: it is
// reached from the loan slip, the back affordance, or `g f`, and the
// tablist stays six wide.
export type ViewId = TabId | 'coach'

// h/l act as vim aliases for ArrowLeft/ArrowRight. The tab buttons
// are not editable, so absorbing single-letter keys is safe.
const isLeftKey  = (key: string) => key === 'ArrowLeft'  || key === 'h'
const isRightKey = (key: string) => key === 'ArrowRight' || key === 'l'

function isTabNavKey(key: string): boolean {
  return isLeftKey(key) || isRightKey(key) || key === 'Home' || key === 'End'
}

// The wrap-around cycle: Left/Right step (mod length), Home/End jump.
// Only called with keys isTabNavKey accepts, so the fall-through is 'End'.
function nextTabIndex(key: string, current: number, length: number): number {
  if (isLeftKey(key))  return (current - 1 + length) % length
  if (isRightKey(key)) return (current + 1) % length
  if (key === 'Home')  return 0
  return length - 1
}

// Where the cycle starts. Normally that is the active view — but the film
// room is a view with no tab, so there the anchor is whichever tab button
// the user has focused. -1 when neither answers, and the cycle stays put.
function cycleAnchor(view: string): number {
  const fromView = TAB_ORDER.indexOf(view as TabId)
  if (fromView !== -1) return fromView
  const focused = document.activeElement
  const id = focused instanceof HTMLElement ? focused.id : ''
  return TAB_ORDER.indexOf(id.replace(/^tab-/, '') as TabId)
}

export function useTabKeyboardNav(
  view: Readonly<Ref<string>>,
  goToView: (next: TabId) => void | Promise<void>,
) {
  function onTabKeydown(e: KeyboardEvent) {
    if (!isTabNavKey(e.key)) return
    e.preventDefault()
    const order = TAB_ORDER
    const current = cycleAnchor(view.value)
    if (current === -1) return
    const target = order[nextTabIndex(e.key, current, order.length)]!
    void goToView(target)
    // Move focus from the now-inactive tab to the newly-active one
    // so the tab pattern's "automatic activation" matches the focus
    // ring on screen.
    void nextTick(() => {
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

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

export const TAB_ORDER = ['settings', 'ingest', 'matches', 'unknown', 'compare', 'elo', 'reviews'] as const

export type TabId = typeof TAB_ORDER[number]

// The tabs by their user-facing names. Keyed on the id UNION rather than
// `string`, so a new tab is a compile error here — the one hard coupling
// that keeps TAB_ORDER, the masthead and the palette agreeing. It sits
// beside TAB_ORDER for the same reason TAB_ORDER sits in its own file:
// adding a tab should not mean re-reading a masthead to find the label.
export const TAB_LABELS: Record<TabId, string> = {
  settings: 'Settings',
  ingest: 'Parse',
  matches: 'Matches',
  unknown: 'Unknown',
  compare: 'Compare',
  elo: 'Elo Calculator',
  reviews: 'Reviews',
}

/** One tab as the masthead renders it: id, label, and its position as `01`. */
export interface TabDescriptor {
  id: TabId
  label: string
  number: string
}

// Derived, not typed: the number IS the position, so `07` reads that way by
// being seventh. Six hand-written buttons with literal `01`–`06` used to
// carry this, and nothing checked they agreed with TAB_ORDER — a tab in
// the array but not the masthead compiled and silently had no button.
export const TABS: readonly TabDescriptor[] = TAB_ORDER.map((id, i) => ({
  id, label: TAB_LABELS[id], number: String(i + 1).padStart(2, '0'),
}))

// Every surface App can show IS a tab. The film room used to be the one
// view outside the tablist — reached from the loan slip, a back affordance,
// or a session-gated `g f` chord, with a hand-maintained "which tab is
// focusable while no tab is selected" fallback in the masthead. It lives
// inside Reviews now, so that special case and every consumer that carried
// it are gone.
export type ViewId = TabId

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

export function useTabKeyboardNav(
  view: Readonly<Ref<TabId>>,
  goToView: (next: TabId) => void | Promise<void>,
) {
  function onTabKeydown(e: KeyboardEvent) {
    if (!isTabNavKey(e.key)) return
    e.preventDefault()
    const order = TAB_ORDER
    // The cycle starts at the active view. Every view is a tab now, so
    // there is no "anchor on the focused button" fallback to carry.
    const current = order.indexOf(view.value)
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

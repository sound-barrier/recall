import { nextTick, type Ref } from 'vue'
import type { MatchRecord } from '../api'
import { useKeyboardShortcuts, type Shortcut } from './useKeyboardShortcuts'
import { type TabId } from './useTabKeyboardNav'

// Global shortcut registry, hoisted out of App.vue so the keyboard
// rules can be unit-tested in isolation and App.vue stops carrying
// the ~100-line `useKeyboardShortcuts([...])` block. Behavior is
// unchanged — same bindings, same suppression rules, same prefix
// sequences. See useKeyboardShortcuts.ts for the dispatcher
// semantics (input-gating, modifier suppression, sequence prefix).
//
// All callbacks the registry needs are passed in as a single
// options object so the composable stays a pure consumer of refs +
// functions App.vue already owns. The only Vue concept it touches
// directly is `nextTick`, used to wait for the teleported narrow
// popover to mount before stealing focus on `/`.

export interface GlobalKeyboardDeps {
  // The active view, used to gate Matches-specific shortcuts and
  // to forward `g <x>` sequence navigation to the right tab.
  view: Ref<TabId>
  // Cheatsheet open state — also doubles as the `suppressed` ref
  // for the dispatcher (no shortcut fires while the modal is up).
  openCheatsheet: Ref<boolean>
  // Whether the detail panel modal is open. Used to suppress
  // Matches-list shortcuts so the panel's own handlers don't race.
  selectionIsOpen: Ref<boolean>
  // The selected match's key — `e` only closes the detail panel
  // when its current selection matches the focused card.
  selectedKey: Ref<string | null>
  // Imperatively close the detail panel from the `e` handler when
  // it's already on the focused card.
  closeSelection: () => void
  // Index into narrowedRecords of the j/k-focused card; -1 means
  // no card focused. Gates `e` / `t` so they no-op when nothing's
  // selected yet.
  focusedCardIndex: Ref<number>
  // The same records array MatchesView renders, used by `e` / `t`
  // to look up the focused card by index.
  narrowedRecords: Ref<MatchRecord[]>
  // Tab-nav helper from App.vue, awaited by `/` so the keypress can
  // bring the Matches tab into focus before clicking the dossier
  // trigger.
  goToView: (tab: TabId) => void | Promise<void>
  // Vertical move helper from App.vue — j/k delegate here so the
  // scroll-into-view + aria-current bookkeeping lives in one place.
  focusCardByRenderedDelta: (delta: 1 | -1) => void | Promise<void>
  // Opens the detail panel for a match key. Reused by `e` (open) and
  // `t` (open + focus tags input).
  toggleExpand: (matchKey: string) => void | Promise<void>
}

export function useGlobalKeyboard(deps: GlobalKeyboardDeps): void {
  const {
    view,
    openCheatsheet,
    selectionIsOpen,
    selectedKey,
    closeSelection,
    focusedCardIndex,
    narrowedRecords,
    goToView,
    focusCardByRenderedDelta,
    toggleExpand,
  } = deps

  useKeyboardShortcuts([
    // Global: open the Narrow panel and focus its search input. The
    // search lives inside the narrow popover (#np-search) — clicking
    // the dossier trigger surfaces it; we then wait a tick for the
    // teleported popover to mount before stealing focus.
    {
      key: '/',
      when: () => !selectionIsOpen.value,
      handler: () => {
        void (async () => {
          if (view.value !== 'matches') await goToView('matches')
          await nextTick()
          if (!document.getElementById('narrow-popover')) {
            const trigger = document.querySelector<HTMLButtonElement>(
              '.dossier-actions .dossier-btn.primary',
            )
            trigger?.click()
            await nextTick()
          }
          const el = document.getElementById('np-search')
          if (el instanceof HTMLInputElement) el.focus()
        })()
      },
    },
    // Global: open the cheatsheet. allowInInput so the user can hit
    // `?` from anywhere — including while typing in a search box.
    {
      key: '?',
      allowInInput: true,
      handler: () => { openCheatsheet.value = true },
    },
    // Global: vim-style view navigation (`g` then a/m/i/s/u).
    ...(['m', 'i', 's', 'u', 'a'] as const).map((follow): Shortcut => {
      const target: TabId = (
        follow === 'm' ? 'matches'  :
        follow === 'i' ? 'ingest'   :
        follow === 's' ? 'settings' :
        follow === 'a' ? 'analysis' : 'unknown'
      )
      return {
        key: follow,
        prefix: 'g',
        handler: () => { void goToView(target) },
      }
    }),
    // Matches view: j/k move card focus, no wrap, in RENDERED order
    // (so flipping Sort=Oldest still has j advance down the visible
    // list — TECHNICAL_DEBT.md item 18). Suppressed when the detail
    // panel is open; the panel's own keydown listener takes over
    // (j/k paginates within the open panel).
    {
      key: 'j',
      when: () => view.value === 'matches' && !selectionIsOpen.value,
      handler: () => { void focusCardByRenderedDelta(1) },
    },
    {
      key: 'k',
      when: () => view.value === 'matches' && !selectionIsOpen.value,
      handler: () => { void focusCardByRenderedDelta(-1) },
    },
    // Matches view: open / close the detail panel for the focused card.
    // From the closed state this is the keyboard alternative to clicking
    // the card. With the panel already open `e` closes it (the panel's
    // own Esc handler does the same).
    {
      key: 'e',
      when: () => view.value === 'matches' && focusedCardIndex.value >= 0,
      handler: () => {
        const rec = narrowedRecords.value[focusedCardIndex.value]
        if (!rec) return
        if (selectionIsOpen.value && selectedKey.value === rec.match_key) {
          closeSelection()
        } else {
          void toggleExpand(rec.match_key)
        }
      },
    },
    // Matches view: open the detail panel for the focused card AND
    // focus its tags input. Tags input has id="tags-<match_key>" per
    // MatchCardExpanded.vue.
    {
      key: 't',
      when: () => view.value === 'matches' && focusedCardIndex.value >= 0,
      handler: async () => {
        const rec = narrowedRecords.value[focusedCardIndex.value]
        if (!rec) return
        if (selectedKey.value !== rec.match_key) {
          await toggleExpand(rec.match_key)
        }
        await nextTick()
        const input = document.getElementById(`tags-${rec.match_key}`)
        if (input instanceof HTMLInputElement) input.focus()
      },
    },
  ], { suppressed: openCheatsheet })
}

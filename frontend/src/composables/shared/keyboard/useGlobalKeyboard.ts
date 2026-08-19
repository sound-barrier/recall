import { computed, nextTick, type Ref } from 'vue'
import type { MatchRecord } from '@/api-client'
import { useKeyboardShortcuts, type Shortcut } from '@/composables/shared/keyboard/useKeyboardShortcuts'
import { type ViewId } from '@/composables/shared/keyboard/useTabKeyboardNav'

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
  // to forward `g <x>` sequence navigation to the right one.
  view: Ref<ViewId>
  // Cheatsheet open state — the `?` shortcut writes it, and it feeds the
  // dispatcher's suppression (no shortcut fires while the modal is up).
  openCheatsheet: Ref<boolean>
  openPalette: Ref<boolean>
  // True while any modal OTHER than the detail panel is up (narrow panel,
  // manual match, About, settings dialog, first-run, startup error, …) —
  // suppresses the whole map. The detail panel deliberately stays out:
  // e-to-close and the j/k interplay are part of the global map.
  modalOpen: Ref<boolean>
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
  goToView: (view: ViewId) => void | Promise<void>
  // Vertical move helper from App.vue — j/k delegate here so the
  // scroll-into-view + aria-current bookkeeping lives in one place.
  focusCardByRenderedDelta: (delta: 1 | -1) => void | Promise<void>
  // Jump card focus to the first / last rendered leaf-row. Backs the
  // vim `gg` (first) and `G` (last) motions.
  focusCardByRenderedEnd: (which: 'first' | 'last') => void | Promise<void>
  // Jump card focus to the first row of the next / previous grouped
  // section (the `.section-divider` boundaries in the cozy/compact
  // list). Backs the vim `n` / `N` motions. No-op when the list is
  // ungrouped (groupBy='none' → no dividers).
  focusSectionByRenderedDelta: (delta: 1 | -1) => void | Promise<void>
  // Opens the detail panel for a match key. Reused by `e` (open),
  // `t` (open + focus tags input), and `l` / → (drill into the card).
  toggleExpand: (matchKey: string) => void | Promise<void>
}

// The `g <x>` sequence's follow-key → view mapping. One key per tab; the
// film room is inside Reviews, so `g r` reaches it (and the tab's index
// when no session is open) — there is no session-gated key any more.
const VIEW_NAV_FOLLOW_KEYS = ['m', 'i', 's', 'u', 'c', 'e', 'r'] as const

type ViewNavKey = typeof VIEW_NAV_FOLLOW_KEYS[number]

const VIEW_NAV_TARGETS: Record<ViewNavKey, ViewId> = {
  m: 'matches', i: 'ingest', s: 'settings', u: 'unknown', c: 'compare', e: 'elo', r: 'reviews',
}

export function useGlobalKeyboard(deps: GlobalKeyboardDeps): void {
  const {
    view,
    openCheatsheet,
    openPalette,
    modalOpen,
    selectionIsOpen,
    selectedKey,
    closeSelection,
    focusedCardIndex,
    narrowedRecords,
    goToView,
    focusCardByRenderedDelta,
    focusCardByRenderedEnd,
    focusSectionByRenderedDelta,
    toggleExpand,
  } = deps

  // Shared gate: a Matches-list motion only fires on the Matches view
  // with no detail panel open (the panel owns j/k/h/l while up).
  const onMatchesList = () => view.value === 'matches' && !selectionIsOpen.value

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
    // Global: vim-style view navigation (`g` then m/i/s/u/c/e/r).
    ...VIEW_NAV_FOLLOW_KEYS.map((follow): Shortcut => ({
      key: follow,
      prefix: 'g',
      handler: () => { void goToView(VIEW_NAV_TARGETS[follow]) },
    })),
    // Matches view: j/k move card focus, no wrap, in RENDERED order
    // (so flipping Sort=Oldest still has j advance down the visible
    // list). ArrowDown/ArrowUp alias j/k so non-vim users get the same
    // navigation. Suppressed when the detail panel is open; the panel's
    // own keydown listener takes over (j/k/arrows paginate within the
    // open panel).
    {
      key: ['j', 'ArrowDown'],
      when: onMatchesList,
      handler: () => { void focusCardByRenderedDelta(1) },
    },
    {
      key: ['k', 'ArrowUp'],
      when: onMatchesList,
      handler: () => { void focusCardByRenderedDelta(-1) },
    },
    // Matches view: gg → first card, G → last card (vim list ends).
    {
      key: 'g',
      prefix: 'g',
      when: onMatchesList,
      handler: () => { void focusCardByRenderedEnd('first') },
    },
    {
      key: 'G',
      when: onMatchesList,
      handler: () => { void focusCardByRenderedEnd('last') },
    },
    // Matches view: n / N jump to the next / previous grouped-section
    // header (Edited / User-entered / OCR, or the Y/M/W/D date groups) —
    // distinct from j/k card-stepping. No-op when the list is ungrouped.
    {
      key: 'n',
      when: onMatchesList,
      handler: () => { void focusSectionByRenderedDelta(1) },
    },
    {
      key: 'N',
      when: onMatchesList,
      handler: () => { void focusSectionByRenderedDelta(-1) },
    },
    // Matches view: l / → drill into the focused card (open its detail
    // panel) — the vim "move right / into" motion. h / ← / Esc back out
    // via the panel's own handlers once it's open.
    {
      key: ['l', 'ArrowRight'],
      when: () => onMatchesList() && focusedCardIndex.value >= 0,
      handler: () => {
        const rec = narrowedRecords.value[focusedCardIndex.value]
        if (rec) void toggleExpand(rec.match_key)
      },
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
      handler: () => {
        void (async () => {
          const rec = narrowedRecords.value[focusedCardIndex.value]
          if (!rec) return
          if (selectedKey.value !== rec.match_key) {
            await toggleExpand(rec.match_key)
          }
          await nextTick()
          const input = document.getElementById(`tags-${rec.match_key}`)
          if (input instanceof HTMLInputElement) input.focus()
        })()
      },
    },
  ], { suppressed: computed(() => openCheatsheet.value || modalOpen.value) })

  // The cheatsheet opener registers on its own dispatcher, exempt from the
  // modal suppression above: `?` must stay reachable from EVERY surface —
  // including inside the narrow panel or a settings dialog — because the
  // cheatsheet is the discovery surface for each context's bindings (it
  // stacks over open modals and filters to the active context).
  useKeyboardShortcuts([
    {
      key: '?',
      allowInInput: true,
      handler: () => { openCheatsheet.value = true },
    },
    {
      // The one command chord in the app. It rides this registry rather than
      // the main one for the same reason `?` does: a jump-anywhere affordance
      // that is unreachable from half the app is not one.
      //
      // Ctrl+F is aliased onto it because on this app the key was dead. Wails
      // calls PutAreBrowserAcceleratorKeysEnabled(false) on every window, so
      // WebView2's find bar never opens and the keystroke reaches the DOM with
      // nothing listening. Pointing it here rather than building a find bar is
      // the deliberate half: the match list is virtualized and one view is
      // mounted at a time, so a find over painted text would search a few
      // dozen rendered rows of a corpus in the thousands and answer "nothing
      // found" about matches that plainly exist. The palette searches the
      // narrowed corpus instead of the paint, which is what the user meant.
      key: ['k', 'f'],
      mod: true,
      allowInInput: true,
      handler: () => { openPalette.value = true },
    },
  ], { suppressed: computed(() => openCheatsheet.value || openPalette.value) })
}

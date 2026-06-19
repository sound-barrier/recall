import { watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'

import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'
import { useTabKeyboardNav, TAB_ORDER } from '@/composables/shared/useTabKeyboardNav'
import { useGlobalKeyboard } from '@/composables/shared/useGlobalKeyboard'

// All App-shell keyboard wiring in one place: the tablist Arrow/Home/End nav,
// the global shortcut registry (j/k, g-prefix tab jumps, e/t card expand, ?
// cheatsheet), the `?` cheatsheet open-flag, and the search→panel auto-track
// watch. Reads view / selection / card-focus / narrow from the stores. Returns
// the bits App's template still needs: the tab keydown handler, the skip-link
// focus helper, and the cheatsheet flag (App threads it to AppOverlays).
export function useAppKeyboard() {
  const appStore = useAppStore()
  const matchesStore = useMatchesStore()
  const uiStore = useUiStore()
  const { view } = storeToRefs(appStore)
  const { goToView } = appStore
  const { selection } = uiStore
  const {
    focusedCardIndex,
    focusCardByRenderedDelta,
    focusCardByRenderedEnd,
    focusSectionByRenderedDelta,
  } = uiStore.cardFocus
  const { matchesNarrow, matchesNarrowState } = matchesStore
  const { searchClauses } = storeToRefs(matchesStore)
  // The `?` cheatsheet flag lives in the UI store (KeyboardShortcutsModal reads
  // it); the registry below toggles it + suppresses shortcuts while it's open.
  const { cheatsheetOpen } = storeToRefs(uiStore)

  // Tablist Arrow/Home/End automatic-activation nav.
  const { onTabKeydown, focusMain } = useTabKeyboardNav(view, goToView)

  // Search → panel auto-track. While the panel is open + the user is searching,
  // the selection follows the first narrowed match so the highlight stays
  // visible. Leaves the selection put when the search clears (no snap-back).
  watch(
    () => matchesNarrowState.searchText.value,
    () => {
      if (!selection.isOpen.value) return
      if (searchClauses.value.length === 0) return
      const first = matchesNarrow.narrowedRecords.value[0]
      if (first && first.match_key !== selection.selectedKey.value) selection.open(first.match_key)
    },
  )

  // Open the detail panel for a key + scroll the source row into view behind it
  // (Matches-view 'e' / 't' shortcuts).
  async function toggleExpand(id: string) {
    selection.open(id)
    await nextTick()
    document.getElementById(`match-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  useGlobalKeyboard({
    view,
    openCheatsheet: cheatsheetOpen,
    selectionIsOpen: selection.isOpen,
    selectedKey: selection.selectedKey,
    closeSelection: selection.close,
    focusedCardIndex,
    narrowedRecords: matchesNarrow.narrowedRecords,
    goToView,
    focusCardByRenderedDelta,
    focusCardByRenderedEnd,
    focusSectionByRenderedDelta,
    toggleExpand,
  })
  // Keep TAB_ORDER referenced so a future tab addition lint-checks the g-prefix
  // coverage (each TAB_ORDER entry needs a matching g+x handler).
  void TAB_ORDER

  return { onTabKeydown, focusMain }
}

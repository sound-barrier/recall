import { computed, markRaw, ref } from 'vue'
import { defineStore } from 'pinia'

import type { MatchRecord } from '@/api-client'
import { useSelectedMatch } from '@/composables/matches/useSelectedMatch'
import { useScreenshotPreview } from '@/composables/shared/useScreenshotPreview'
import { useCardFocus } from '@/composables/matches/useCardFocus'
import { useAnchorToast } from '@/composables/app/useAnchorToast'
import { useFirstRun } from '@/composables/app/useFirstRun'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'

// App-shell UI state: the right-side detail-panel selection, the
// source-screenshot preview/lightbox cache, and the j/k card-focus index.
// Migrated out of App.vue. Exposed as markRaw composable bundles — Pinia's
// reactive() store would otherwise deep-unwrap their inner refs (see the
// matches store's narrow cluster for the same gotcha); markRaw keeps the
// refs intact and reactive. Consumers destructure the bundle into top-level
// vars, same CardStateApi convention used across the app.
export const useUiStore = defineStore('ui', () => {
  const appStore = useAppStore()
  const matchesStore = useMatchesStore()

  // Detail-panel selection paginates against the SAME narrowedRecords the
  // Matches view shows, so it tracks filter/hide/re-parse changes.
  const selection = useSelectedMatch(matchesStore.matchesNarrow.narrowedRecords)
  const preview = useScreenshotPreview()
  const cardFocus = useCardFocus()

  // The "since this match" anchor toast + the first-run "name your main
  // account" gate are App-shell overlay state; they live here so AppOverlays
  // reads them straight from the store (no App-assembled prop bundle).
  const anchor = useAnchorToast()
  const firstRun = useFirstRun()

  // The `?` keyboard cheatsheet flag (useAppKeyboard's shortcut registry
  // toggles it; KeyboardShortcutsModal reads it).
  const cheatsheetOpen = ref(false)
  function closeCheatsheet() { cheatsheetOpen.value = false }

  // Pending detail-panel focus target: the row context menu sets it ('note' /
  // 'tag') and opens the match; MatchDetailPanel reads it on mount to focus the
  // right input, then clears it. Lives here (not the panel) because the panel
  // may be unmounted at the moment of right-click.
  const pendingFocusTarget = ref<'note' | 'tag' | ''>('')
  function clearPendingFocus() { pendingFocusTarget.value = '' }
  function onOpenMatchAndFocus(matchKey: string, target: 'note' | 'tag') {
    pendingFocusTarget.value = target
    selection.open(matchKey)
  }

  // Per-match "Source Screenshots" expand state, keyed by match_key. Shared by
  // the detail panel AND UnknownMapsView (both consult one owner via the
  // CardStateApi bundle App assembles), so it survives a tab swap.
  const sourcesExpanded = ref<Record<string, boolean>>({})
  function toggleSources(id: string) {
    sourcesExpanded.value = { ...sourcesExpanded.value, [id]: !sourcesExpanded.value[id] }
  }
  function isSourcesOpen(id: string) { return !!sourcesExpanded.value[id] }

  // App-shell modal open-flags. MatchesView's "Narrow this set" panel + the
  // manual-match modal both freeze the background while up (App reads these in
  // its backgroundFrozen computed). They live here so MatchesView flips them
  // directly + App/AppOverlays read them without prop/emit drilling.
  const narrowOpen = ref(false)
  function setNarrowOpen(open: boolean) { narrowOpen.value = open }

  const manualMatchOpen = ref(false)
  function openManualMatch() { manualMatchOpen.value = true }
  function closeManualMatch() { manualMatchOpen.value = false }
  // A manual match was created → close the modal, reload so it lands in the
  // feed, and open it so the user can add the right-panel review / replay-code.
  async function onManualMatchCreated(rec: MatchRecord) {
    manualMatchOpen.value = false
    await matchesStore.load()
    selection.open(rec.match_key)
  }

  // Every full-surface modal that should freeze the background — App's
  // `.container` + ParseStatusBar flip `inert` + aria-hidden off this so screen
  // readers + Tab nav don't bleed into the dimmed page. Reads the startup-error
  // gate from the app store + the unsupported-OCR gate from the matches store;
  // the rest are this store's own flags. Add to it when a new modal mounts.
  const backgroundFrozen = computed(() =>
    firstRun.firstRunModalOpen.value
    || appStore.showStartupErrorModal
    || matchesStore.showUnsupportedModal
    || selection.isOpen.value
    || narrowOpen.value
    || manualMatchOpen.value,
  )

  return {
    selection: markRaw(selection),
    preview: markRaw(preview),
    cardFocus: markRaw(cardFocus),
    pendingFocusTarget,
    clearPendingFocus,
    onOpenMatchAndFocus,
    toggleSources,
    isSourcesOpen,
    narrowOpen,
    setNarrowOpen,
    manualMatchOpen,
    openManualMatch,
    closeManualMatch,
    onManualMatchCreated,
    cheatsheetOpen,
    closeCheatsheet,
    backgroundFrozen,
    // Anchor toast (delegated to useAnchorToast)
    anchorToast: anchor.anchorToast,
    onSetAnchor: anchor.onSetAnchor,
    onAnchorToastViewFilter: anchor.onAnchorToastViewFilter,
    onAnchorToastDismiss: anchor.onAnchorToastDismiss,
    // First-run gate (delegated to useFirstRun)
    firstRunModalOpen: firstRun.firstRunModalOpen,
    onFirstRunDismiss: firstRun.onFirstRunDismiss,
    onFirstRunPickSource: firstRun.onFirstRunPickSource,
    onFirstRunPickCustomSource: firstRun.onFirstRunPickCustomSource,
  }
})

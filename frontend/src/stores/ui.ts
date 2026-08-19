import { computed, markRaw, ref } from 'vue'
import type { ManualMatchMode } from '@/composables/matches/manual/useManualMatchForm'
import { defineStore } from 'pinia'

import type { MatchRecord } from '@/api-client'
import { useSelectedMatch } from '@/composables/matches/detail/useSelectedMatch'
import { useScreenshotPreview } from '@/composables/shared/media/useScreenshotPreview'
import { useCardFocus } from '@/composables/shared/useCardFocus'
import { useAnchorToast } from '@/composables/app/useAnchorToast'
import { useUndoHideToast } from '@/composables/app/useUndoHideToast'
import { useFirstRun } from '@/composables/app/useFirstRun'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useParseStore } from '@/stores/parse'

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
  const parseStore = useParseStore()

  // Detail-panel selection paginates against the SAME narrowedRecords the
  // Matches view shows, so it tracks filter/hide/re-parse changes.
  const selection = useSelectedMatch(matchesStore.matchesNarrow.narrowedRecords)
  const preview = useScreenshotPreview()
  const cardFocus = useCardFocus()

  // The "since this match" anchor toast + the first-run "name your main
  // account" gate are App-shell overlay state; they live here so AppOverlays
  // reads them straight from the store (no App-assembled prop bundle).
  const anchor = useAnchorToast()
  const undoHide = useUndoHideToast()
  const firstRun = useFirstRun()

  // The `?` keyboard cheatsheet flag (useAppKeyboard's shortcut registry
  // toggles it; KeyboardShortcutsModal reads it).
  // The one-shot "how to pick matches to review" hint over the Matches list.
  // Raised by the Reviews tab's "Pick matches…" start; cleared by the first
  // tick, its own dismiss, or leaving the list.
  const reviewPickHint = ref(false)
  function showReviewPickHint() { reviewPickHint.value = true }
  function clearReviewPickHint() { reviewPickHint.value = false }

  const cheatsheetOpen = ref(false)
  function openCheatsheet() { cheatsheetOpen.value = true }
  function closeCheatsheet() { cheatsheetOpen.value = false }

  // The command palette. Like the cheatsheet it is opened from the global
  // keyboard registry, and like the cheatsheet it must MUTE the app's other
  // shortcuts while open — the user is typing a query, and every bare letter in
  // it would otherwise also be a command.
  const paletteOpen = ref(false)
  function openPalette() { paletteOpen.value = true }
  function closePalette() { paletteOpen.value = false }

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
  // Which entry point opened the modal — the toolbar's Add-match menu offers
  // the full form and the leaver-exit quick-add, and they share one component.
  const manualMatchMode = ref<ManualMatchMode>('full')
  function openManualMatch(mode: ManualMatchMode = 'full') {
    manualMatchMode.value = mode
    manualMatchOpen.value = true
  }
  function closeManualMatch() { manualMatchOpen.value = false }

  // Settings dialog — the ⌘, / app-menu / kebab entry point. A floating
  // Preferences-style modal that mirrors the Settings tab's sections; the tab
  // stays. Freezes the background like every other full-surface modal.
  const settingsDialogOpen = ref(false)
  function openSettingsDialog() { settingsDialogOpen.value = true }
  function closeSettingsDialog() { settingsDialogOpen.value = false }

  // One-shot "replay the onboarding tour" request — Settings → Advanced
  // raises it; OnboardingTour (mounted in AppOverlays) watches, clears it,
  // and restarts from step 0. A flag rather than a direct call because the
  // tour controller lives inside the overlay component, not in a store.
  const tourReplayRequested = ref(false)
  function requestTourReplay() { tourReplayRequested.value = true }
  function clearTourReplayRequest() { tourReplayRequested.value = false }

  // One-shot "open the Trends section" request — the same shape as the tour
  // replay above. The coaching session's nav strip offers "Trends" among the
  // player's views, but Trends is a SECTION of the Matches view rather than a
  // tab, so the strip goes to Matches and raises this; TrendsSection opens
  // itself once and clears it.
  const trendsOpenRequested = ref(false)
  function requestTrendsOpen() { trendsOpenRequested.value = true }
  function clearTrendsOpenRequest() { trendsOpenRequested.value = false }
  // Open the detail panel on a match the caller was not looking at — a
  // received review's first match from the Reviews shelf, a match just
  // created by hand. The panel paginates against narrowedRecords, and
  // `selection.open` on a key outside that list opens NOTHING while still
  // marking the page inert: a window that silently stops responding with no
  // modal to close (the palette met the same hole and answered it by only
  // offering matches inside the narrow). Here the narrow is widened instead —
  // the caller named a match, so the match wins over the filter — and a key
  // the widened set still lacks (hidden) is left closed rather than frozen.
  // Returns whether the panel opened.
  function revealMatch(matchKey: string): boolean {
    const inNarrow = () => matchesStore.matchesNarrow.narrowedRecords.value
      .some((r) => r.match_key === matchKey)
    if (!inNarrow()) matchesStore.matchesNarrow.resetNarrow()
    if (!inNarrow()) return false
    selection.open(matchKey)
    return true
  }

  // A manual match was created → close the modal, reload so it lands in the
  // feed, and open it so the user can add the right-panel review / replay-code.
  async function onManualMatchCreated(rec: MatchRecord) {
    manualMatchOpen.value = false
    await matchesStore.load()
    revealMatch(rec.match_key)
  }

  // Every full-surface modal that should freeze the background — App's
  // `.container` + ParseStatusBar flip `inert` + aria-hidden off this so screen
  // readers + Tab nav don't bleed into the dimmed page. Reads the startup-error
  // gate from the app store + the unsupported-OCR gate from the parse store;
  // the rest are this store's own flags. Add to it when a new modal mounts.
  // Every modal that should mute the global keyboard map. The detail panel
  // (selection) deliberately stays out — e-to-close and the j/k interplay
  // are part of the global map while it's open; the cheatsheet suppresses
  // itself via its own ref in useAppKeyboard.
  const shortcutMutingModalOpen = computed(() =>
    firstRun.firstRunModalOpen.value
    || appStore.showStartupErrorModal
    || parseStore.showUnsupportedModal
    || narrowOpen.value
    || manualMatchOpen.value
    || settingsDialogOpen.value
    || paletteOpen.value
    || appStore.aboutOpen,
  )

  const backgroundFrozen = computed(() =>
    shortcutMutingModalOpen.value || selection.isOpen.value,
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
    manualMatchMode,
    openManualMatch,
    closeManualMatch,
    onManualMatchCreated,
    revealMatch,
    settingsDialogOpen,
    openSettingsDialog,
    closeSettingsDialog,
    tourReplayRequested,
    requestTourReplay,
    clearTourReplayRequest,
    trendsOpenRequested,
    requestTrendsOpen,
    clearTrendsOpenRequest,
    reviewPickHint,
    showReviewPickHint,
    clearReviewPickHint,
    cheatsheetOpen,
    openCheatsheet,
    closeCheatsheet,
    paletteOpen,
    openPalette,
    closePalette,
    backgroundFrozen,
    shortcutMutingModalOpen,
    // Anchor toast (delegated to useAnchorToast)
    anchorToast: anchor.anchorToast,
    onSetAnchor: anchor.onSetAnchor,
    onAnchorToastViewFilter: anchor.onAnchorToastViewFilter,
    onAnchorToastDismiss: anchor.onAnchorToastDismiss,
    // Undo-hide toast (delegated to useUndoHideToast)
    undoHideToast: undoHide.undoHideToast,
    showUndoHide: undoHide.showUndoHide,
    onUndoHide: undoHide.onUndoHide,
    onUndoHideDismiss: undoHide.onUndoHideDismiss,
    // First-run gate (delegated to useFirstRun)
    firstRunModalOpen: firstRun.firstRunModalOpen,
    onFirstRunDismiss: firstRun.onFirstRunDismiss,
    onFirstRunPickSource: firstRun.onFirstRunPickSource,
    onFirstRunPickCustomSource: firstRun.onFirstRunPickCustomSource,
  }
})

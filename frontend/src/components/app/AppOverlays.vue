<script setup lang="ts">
// App-shell overlay cluster — every modal / toast / lightbox / tour surface
// that floats above the routed views. Extracted from App.vue's template to keep
// the shell navigable. Reads ALL of its state from the stores (selection +
// preview + anchor toast + first-run gate + cheatsheet from the UI store;
// records/parse/export/tour from the matches store; update-check + startup-error
// from the app store; Tesseract + source candidates from settings) plus its own
// onboarding-tour bridge (a stateless DOM/nav helper) — so App mounts it with no
// props.
import { computed, defineAsyncComponent, type Component } from 'vue'
import ViewLoadError from '@/components/app/ViewLoadError.vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'
import { useSelfReviewStore } from '@/stores/selfReview'
import { useMatchesStore } from '@/stores/matches'
import { useParseStore } from '@/stores/parse'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useOnboardingTourBridge } from '@/composables/app/useOnboardingTourBridge'
import { useFocusNudge } from '@/composables/matches/useFocusNudge'
import { useTiltNudge } from '@/composables/matches/list/useTiltNudge'
import { screenshotURL } from '@/match/match-helpers'
import StartupErrorModal from '@/components/app/StartupErrorModal.vue'
import UnsupportedModal from '@/components/app/UnsupportedModal.vue'

// Same lazy split App.vue had — each becomes its own Vite chunk, fetched on
// first open. App.lazy-views.test guards the pattern (it reads this file too).

// Shared factory: a modal chunk that fails to load renders the same
// reload affordance the lazy views use — otherwise the open-flag
// flips and nothing appears (see ViewLoadError.vue).
function lazyOverlay(loader: () => Promise<{ default: Component }>) {
  return defineAsyncComponent({ loader, errorComponent: ViewLoadError })
}

const AboutModal = lazyOverlay(() => import('@/components/update/AboutModal.vue'))
const SettingsModal = lazyOverlay(() => import('@/components/settings/SettingsModal.vue'))
const FirstRunProfileModal = lazyOverlay(() => import('@/components/app/FirstRunProfileModal.vue'))
const ExportBundleModal = lazyOverlay(() => import('@/components/matches/export/ExportBundleModal.vue'))
const SendToCoachModal = lazyOverlay(() => import('@/components/reviews/SendToCoachModal.vue'))
const IgnoredFilesPanel = lazyOverlay(() => import('@/components/ingest/ignored/IgnoredFilesPanel.vue'))
const MatchDetailPanel = lazyOverlay(() => import('@/components/matches/detail/MatchDetailPanel.vue'))
const MatchAnchorToast = lazyOverlay(() => import('@/components/matches/toasts/MatchAnchorToast.vue'))
const MatchUndoToast = lazyOverlay(() => import('@/components/matches/toasts/MatchUndoToast.vue'))
const TiltNudgeToast = lazyOverlay(() => import('@/components/matches/toasts/TiltNudgeToast.vue'))
const SessionSummaryToast = lazyOverlay(() => import('@/components/matches/toasts/SessionSummaryToast.vue'))
const ParseOutcomeToast = lazyOverlay(() => import('@/components/ingest/ParseOutcomeToast.vue'))
const FocusNudgeToast = lazyOverlay(() => import('@/components/matches/toasts/FocusNudgeToast.vue'))
const MatchScreenshotLightbox = lazyOverlay(() => import('@/components/matches/detail/MatchScreenshotLightbox.vue'))
const KeyboardShortcutsModal = lazyOverlay(() => import('@/components/app/KeyboardShortcutsModal.vue'))
const CommandPalette = lazyOverlay(() => import('@/components/shared/CommandPalette.vue'))
const ManualMatchModal = lazyOverlay(() => import('@/components/matches/manual/ManualMatchModal.vue'))
const OnboardingTour = lazyOverlay(() => import('@/components/onboarding/OnboardingTour.vue'))
const CoachReturnSheet = lazyOverlay(() => import('@/components/coach/inbox/CoachReturnSheet.vue'))

const appStore = useAppStore()
const matchesStore = useMatchesStore()
const parseStore = useParseStore()
const settingsStore = useSettingsStore()
const uiStore = useUiStore()
// The cheatsheet advertises the film room's reel bindings only while the
// room is open — a coach's session or the player's own sitting, the same
// two signals ReviewsView renders it on.
const { sessionActive } = storeToRefs(useCoachStore())
const { roomOpen: sittingOpen } = storeToRefs(useSelfReviewStore())
const roomOpen = computed(() => sessionActive.value || sittingOpen.value)
// Stateless DOM/nav bridge — its own instance is fine (no shared state).
const tourBridge = useOnboardingTourBridge()

// UI store — selection/preview + the manual-match modal + anchor toast +
// cheatsheet + first-run gate (all overlay state).
const {
  selection, preview,
  closeManualMatch, onManualMatchCreated,
  onSetAnchor, onAnchorToastViewFilter, onAnchorToastDismiss,
  onUndoHide, onUndoHideDismiss,
  closeCheatsheet, closeSettingsDialog,
  onFirstRunDismiss, onFirstRunPickSource, onFirstRunPickCustomSource,
} = uiStore
const { manualMatchOpen, manualMatchMode, anchorToast, undoHideToast, cheatsheetOpen, paletteOpen, firstRunModalOpen, settingsDialogOpen } = storeToRefs(uiStore)

// App store — About (version + update hub) + the non-dismissible startup gate.
const {
  view, appVersion, updateInfo, updateCheckBusy, aboutOpen, selfUpdate,
  startupError, showStartupErrorModal,
} = storeToRefs(appStore)
const { closeAbout, startSelfUpdate, restartToApply } = appStore

// Settings — Tesseract + the first-run source candidates.
const { tesseractStatus, screenshotCandidates, probing } = storeToRefs(settingsStore)

// Matches — record buckets + the export-bundle modal.
const {
  hiddenRecords,
  unknownRecords,
  exportBundleOpen,
  exportBundleSelectedKeys,
  records,
} = storeToRefs(matchesStore)

// Parse — the unsupported-engine gate, the ignored-screenshots panel, and the
// post-run session tally toast.
const {
  showUnsupportedModal,
  ignoredPanelOpen,
  ignoredScreenshots,
  sessionToast,
  parseOutcome,
  currentSession,
} = storeToRefs(parseStore)

// What to work on, while there is still a game left to work on it in.
// Gated on a session being live, so the read only ever fires off a parse the
// user asked for — never at boot.
const focusNudge = useFocusNudge(currentSession)

// Tilt nudge — evaluated over the FULL record set (tilt is about
// actual recent play, not the current narrow); dismissal is
// session-scoped to the streak inside the composable.
const tiltNudge = useTiltNudge(records)
const {
  load,
  onTourActiveChange,
  closeExportBundle,
  onExportBundleConfirm,
} = matchesStore
const {
  confirmUnsupportedParse,
  closeIgnoredPanel,
  onUnignoreScreenshot,
  onClearIgnoredScreenshots,
  onRunParseFromIgnored,
} = parseStore

const lightboxSrc = computed(() => {
  const f = preview.lightboxFilename.value
  if (!f) return null
  return screenshotURL(f, preview.lightboxDirIDs.value[f] ?? 0)
})
</script>

<template>
  <!-- Reads selection / preview / narrow / mutations from the stores;
       App still owns the anchor-confirmation toast, so set-anchor is the
       one event it handles. -->
  <MatchDetailPanel @set-anchor="onSetAnchor" />

  <!-- Anchor confirmation toast — appears bottom-right when the "since"
       reference is set or cleared. -->
  <MatchAnchorToast
    :state="anchorToast"
    @view-filter="onAnchorToastViewFilter"
    @dismiss="onAnchorToastDismiss"
  />

  <!-- Undo-hide toast — appears bottom-right after hiding a match so the
       archive move is recoverable in one click. -->
  <MatchUndoToast
    :state="undoHideToast"
    @undo="onUndoHide"
    @dismiss="onUndoHideDismiss"
  />

  <!-- Post-parse session tally — a "Session so far" readout raised when a run
       lands during an active session. It stays up while the session is still
       on: it expires when the session does, and a dismissed session does not
       come back on the next parse. -->
  <SessionSummaryToast
    :state="sessionToast"
    @dismiss="parseStore.dismissSessionToast"
  />

  <!-- End-of-run outcome — "X read · Y failed to read" off the
       parse-complete payload, with the door to the Unknown tab's triage
       when anything failed. Transient by design; the Failed section
       keeps the durable record. -->
  <ParseOutcomeToast
    :state="parseOutcome"
    @dismiss="parseStore.dismissParseOutcome"
  />

  <!-- What to focus on this session: the top three of the player's list,
       coach items first. Session-scoped; never auto-dismisses. -->
  <FocusNudgeToast
    :items="focusNudge.items.value"
    :visible="focusNudge.visible.value"
    @dismiss="focusNudge.dismiss"
  />

  <!-- Tilt nudge — dismissible break suggestion on a collapsed loss
       streak. Session-scoped; never auto-dismisses. -->
  <TiltNudgeToast
    :signal="tiltNudge.visibleSignal.value"
    @dismiss="tiltNudge.dismiss"
  />

  <!-- Fullscreen screenshot lightbox — stacks above the detail panel via
       z-index. Esc / × / backdrop close; ← / → navigate the owning match's
       source_files (snapshotted on open). -->
  <MatchScreenshotLightbox
    :filename="preview.lightboxFilename.value"
    :src="lightboxSrc"
    :files="preview.lightboxFiles.value"
    :index="preview.lightboxIndex.value"
    @close="preview.closeLightbox"
    @prev="preview.lightboxPrev"
    @next="preview.lightboxNext"
  />

  <!-- Startup-failure modal. Non-empty message means the Go layer captured a
       profile-init / DB-open failure. No close affordance — restart recovers. -->
  <StartupErrorModal :open="showStartupErrorModal" :message="startupError" />

  <!-- Unsupported Tesseract version confirmation modal -->
  <UnsupportedModal
    :open="showUnsupportedModal"
    :version="tesseractStatus.version"
    @cancel="showUnsupportedModal = false"
    @confirm="confirmUnsupportedParse"
  />

  <!-- Keyboard-shortcut cheatsheet. Opened by the `?` binding, closed via Esc
       / footer button / click-outside. -->
  <KeyboardShortcutsModal
    :open="cheatsheetOpen"
    :view="view"
    :panel-open="selection.isOpen.value"
    :room-open="roomOpen"
    @close="closeCheatsheet"
  />

  <!-- Command palette. Lazy like every other substantial modal surface: the
       initial-JS budget has a few KB of headroom, and a jump-to affordance
       nobody has opened yet has no business in the first chunk. -->
  <CommandPalette :open="paletteOpen" @close="uiStore.closePalette()" />

  <ManualMatchModal
    :key="manualMatchMode"
    :open="manualMatchOpen"
    :mode="manualMatchMode"
    @close="closeManualMatch"
    @created="onManualMatchCreated"
  />

  <!-- First-launch tour overlay. Self-gates via localStorage. Steps drive the
       app via @navigate / @open-match / @open-narrow / @apply-hero-filter etc.;
       @active-change swaps in demo data so every step lands on something. -->
  <OnboardingTour
    :seed-and-switch-to-test="tourBridge.onTourSeedAndSwitch"
    @navigate="(v: string) => appStore.goToView(v as Parameters<typeof appStore.goToView>[0])"
    @active-change="onTourActiveChange"
    @open-match="(k: string) => selection.open(k)"
    @close-match="selection.close"
    @open-narrow="tourBridge.onTourOpenNarrow"
    @close-narrow="tourBridge.onTourCloseNarrow"
    @apply-hero-filter="tourBridge.onTourApplyHeroFilter"
    @clear-filters="tourBridge.onTourClearFilters"
  />

  <!-- First-run "Main account name" modal. Forced gate — every other surface
       is inert + aria-hidden while this is up. ESC + backdrop don't close it. -->
  <FirstRunProfileModal
    v-if="firstRunModalOpen"
    :platform="tesseractStatus?.platform ?? ''"
    :candidates="screenshotCandidates"
    :picking="probing"
    @dismiss="onFirstRunDismiss"
    @pick-source="onFirstRunPickSource"
    @pick-custom-source="onFirstRunPickCustomSource"
  />

  <!-- Export backup modal — opens from the Matches bulk-action bar's
       "Export backup…" button. -->
  <ExportBundleModal
    :open="exportBundleOpen"
    :selected-count="exportBundleSelectedKeys.length"
    :hidden-count="hiddenRecords.length"
    :unknown-count="unknownRecords.length"
    @close="closeExportBundle"
    @export="onExportBundleConfirm"
  />

  <!-- Sending matches to a coach. Reads the store directly (the overlay
       cluster's rule) — and taking no props is what moved the replay-code
       math out of this file, where it never belonged. -->
  <SendToCoachModal />

  <IgnoredFilesPanel
    :is-open="ignoredPanelOpen"
    :screenshots="ignoredScreenshots"
    :screenshot-u-r-l="(filename: string) => screenshotURL(filename, 0)"
    @close="closeIgnoredPanel"
    @restore="onUnignoreScreenshot"
    @restore-all="onClearIgnoredScreenshots"
    @run-parse="onRunParseFromIgnored"
    @open-lightbox="preview.openLightbox"
  />

  <!-- About Recall — identity + update hub. Opens from the native menu /
       ⋮ kebab / 90-day reminder banner. Lazy so its bundle is only paid for
       by users who open it. -->
  <AboutModal
    :open="aboutOpen"
    :update-info="updateInfo"
    :current-version="appVersion"
    :checking="updateCheckBusy"
    :self-update="selfUpdate"
    @close="closeAbout"
    @applied="load"
    @install="startSelfUpdate"
    @restart="restartToApply"
  />

  <!-- Settings dialog — the ⌘, / app-menu / kebab Preferences surface. Mirrors
       the Settings tab's sections; the tab stays. Lazy-loaded. -->
  <SettingsModal :open="settingsDialogOpen" @close="closeSettingsDialog" />

  <!-- The return of notes — one card per note the coach sent back, opened by
       the import that staged it or by the Matches banner. Reads the staged
       sheet off the coach store, so it takes no props. -->
  <CoachReturnSheet />
</template>

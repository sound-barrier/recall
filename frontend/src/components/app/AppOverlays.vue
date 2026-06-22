<script setup lang="ts">
// App-shell overlay cluster — every modal / toast / lightbox / tour surface
// that floats above the routed views. Extracted from App.vue's template to keep
// the shell navigable. Reads ALL of its state from the stores (selection +
// preview + anchor toast + first-run gate + cheatsheet from the UI store;
// records/parse/export/tour from the matches store; update-check + startup-error
// from the app store; Tesseract + source candidates from settings) plus its own
// onboarding-tour bridge (a stateless DOM/nav helper) — so App mounts it with no
// props.
import { computed, defineAsyncComponent } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useOnboardingTourBridge } from '@/composables/app/useOnboardingTourBridge'
import { screenshotURL } from '@/match/match-helpers'
import StartupErrorModal from '@/components/app/StartupErrorModal.vue'
import UnsupportedModal from '@/components/app/UnsupportedModal.vue'

// Same lazy split App.vue had — each becomes its own Vite chunk, fetched on
// first open. App.lazy-views.test guards the pattern (it reads this file too).
const UpdateCheckModal = defineAsyncComponent(() => import('@/components/shared/UpdateCheckModal.vue'))
const FirstRunProfileModal = defineAsyncComponent(() => import('@/components/shared/FirstRunProfileModal.vue'))
const ExportBundleModal = defineAsyncComponent(() => import('@/components/settings/ExportBundleModal.vue'))
const IgnoredFilesPanel = defineAsyncComponent(() => import('@/components/settings/IgnoredFilesPanel.vue'))
const MatchDetailPanel = defineAsyncComponent(() => import('@/components/matches/detail/MatchDetailPanel.vue'))
const MatchAnchorToast = defineAsyncComponent(() => import('@/components/matches/list/MatchAnchorToast.vue'))
const MatchUndoToast = defineAsyncComponent(() => import('@/components/matches/list/MatchUndoToast.vue'))
const MatchScreenshotLightbox = defineAsyncComponent(() => import('@/components/matches/detail/MatchScreenshotLightbox.vue'))
const KeyboardShortcutsModal = defineAsyncComponent(() => import('@/components/shared/KeyboardShortcutsModal.vue'))
const ManualMatchModal = defineAsyncComponent(() => import('@/components/matches/manual/ManualMatchModal.vue'))
const OnboardingTour = defineAsyncComponent(() => import('@/components/shared/OnboardingTour.vue'))

const appStore = useAppStore()
const matchesStore = useMatchesStore()
const settingsStore = useSettingsStore()
const uiStore = useUiStore()
// Stateless DOM/nav bridge — its own instance is fine (no shared state).
const tourBridge = useOnboardingTourBridge()

// UI store — selection/preview + the manual-match modal + anchor toast +
// cheatsheet + first-run gate (all overlay state).
const {
  selection, preview,
  closeManualMatch, onManualMatchCreated,
  onSetAnchor, onAnchorToastViewFilter, onAnchorToastDismiss,
  onUndoHide, onUndoHideDismiss,
  closeCheatsheet,
  onFirstRunDismiss, onFirstRunPickSource, onFirstRunPickCustomSource,
} = uiStore
const { manualMatchOpen, anchorToast, undoHideToast, cheatsheetOpen, firstRunModalOpen } = storeToRefs(uiStore)

// App store — update-check + the non-dismissible startup-error gate.
const {
  view, appVersion, updateInfo, updateCheckBusy, updateCheckModalOpen,
  startupError, showStartupErrorModal,
} = storeToRefs(appStore)

// Settings — Tesseract + the first-run source candidates.
const { tesseractStatus, screenshotCandidates, probing } = storeToRefs(settingsStore)

// Matches — record buckets + ignored panel + parse gate + export-bundle modal.
const {
  showUnsupportedModal,
  ignoredPanelOpen,
  ignoredScreenshots,
  hiddenRecords,
  unknownRecords,
  exportBundleOpen,
  exportBundleSelectedKeys,
} = storeToRefs(matchesStore)
const {
  confirmUnsupportedParse,
  closeIgnoredPanel,
  onUnignoreScreenshot,
  onClearIgnoredScreenshots,
  onRunParseFromIgnored,
  load,
  onTourActiveChange,
  closeExportBundle,
  onExportBundleConfirm,
} = matchesStore

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
    @close="closeCheatsheet"
  />

  <ManualMatchModal
    :open="manualMatchOpen"
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

  <!-- Export bundle modal — opens from the Matches bulk-action bar's
       "Export bundle…" button. -->
  <ExportBundleModal
    :open="exportBundleOpen"
    :selected-count="exportBundleSelectedKeys.length"
    :hidden-count="hiddenRecords.length"
    :unknown-count="unknownRecords.length"
    @close="closeExportBundle"
    @export="onExportBundleConfirm"
  />

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

  <!-- Update-check modal — opens from the masthead's "Check for updates"
       button. Lazy so its bundle is only paid for by users who run the check. -->
  <UpdateCheckModal
    :open="updateCheckModalOpen"
    :update-info="updateInfo"
    :current-version="appVersion"
    :checking="updateCheckBusy"
    @close="updateCheckModalOpen = false"
    @applied="load"
  />
</template>

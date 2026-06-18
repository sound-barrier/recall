<script setup lang="ts">
// App-shell overlay cluster — every modal / toast / lightbox / tour surface
// that floats above the routed views. Extracted from App.vue's template to keep
// the shell navigable. Reads its store-backed state directly (selection +
// preview from the UI store, ignored-list + parse-gate + record buckets from
// the matches store, update-check from the app store, Tesseract from settings);
// the genuinely App-local state — modal flags App also needs for its
// background-freeze (`inert`) computed, plus the toast/tour handlers that do DOM
// + view-nav — arrives as one typed `api` bundle. Refs in that bundle don't
// auto-unwrap in the template, so they're read with `.value`.
import { computed, defineAsyncComponent, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { MatchRecord, NamedCandidate } from '@/api'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
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
const MatchScreenshotLightbox = defineAsyncComponent(() => import('@/components/matches/detail/MatchScreenshotLightbox.vue'))
const KeyboardShortcutsModal = defineAsyncComponent(() => import('@/components/shared/KeyboardShortcutsModal.vue'))
const ManualMatchModal = defineAsyncComponent(() => import('@/components/matches/manual/ManualMatchModal.vue'))
const OnboardingTour = defineAsyncComponent(() => import('@/components/shared/OnboardingTour.vue'))

interface AnchorToastState { kind: 'set' | 'cleared'; label: string; token: number }

// App-shell-local overlay state — flags App also reads for its background-freeze
// computed, plus the toast/tour handlers that reach into the DOM / view nav.
export interface OverlaysApi {
  anchorToast: Ref<AnchorToastState | null>
  onSetAnchor: (matchKey: string) => void
  onAnchorToastViewFilter: () => void
  onAnchorToastDismiss: (token: number) => void
  showStartupErrorModal: Ref<boolean>
  startupErrorMessage: Ref<string>
  openCheatsheet: Ref<boolean>
  closeCheatsheet: () => void
  showManualMatchModal: Ref<boolean>
  closeManualMatch: () => void
  onManualMatchCreated: (rec: MatchRecord) => void
  firstRunModalOpen: Ref<boolean>
  screenshotCandidates: Ref<NamedCandidate[]>
  probing: Ref<boolean>
  onFirstRunDismiss: (renamedTo: string | null) => void
  onFirstRunPickSource: (path: string) => void
  onFirstRunPickCustomSource: () => void
  exportBundleOpen: Ref<boolean>
  exportBundleSelectedKeys: Ref<string[]>
  closeExportBundle: () => void
  onExportBundleConfirm: (filename: string, includeHidden: boolean, includeUnknown: boolean) => void
  onTourSeedAndSwitch: (resumeStepIndex: number) => Promise<void>
  onTourActiveChange: (active: boolean) => void
  onTourOpenNarrow: () => void
  onTourCloseNarrow: () => void
  onTourApplyHeroFilter: (hero: string) => void
  onTourClearFilters: () => void
}

defineProps<{ api: OverlaysApi }>()

const appStore = useAppStore()
const matchesStore = useMatchesStore()
const settingsStore = useSettingsStore()
const uiStore = useUiStore()
const { selection, preview } = uiStore
const { view, appVersion, updateInfo, updateCheckBusy, updateCheckModalOpen } = storeToRefs(appStore)
const { tesseractStatus } = storeToRefs(settingsStore)
const {
  showUnsupportedModal,
  ignoredPanelOpen,
  ignoredScreenshots,
  hiddenRecords,
  unknownRecords,
} = storeToRefs(matchesStore)
const {
  confirmUnsupportedParse,
  closeIgnoredPanel,
  onUnignoreScreenshot,
  onClearIgnoredScreenshots,
  onRunParseFromIgnored,
  load,
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
  <MatchDetailPanel @set-anchor="api.onSetAnchor" />

  <!-- Anchor confirmation toast — appears bottom-right when the "since"
       reference is set or cleared. -->
  <MatchAnchorToast
    :state="api.anchorToast.value"
    @view-filter="api.onAnchorToastViewFilter"
    @dismiss="api.onAnchorToastDismiss"
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
  <StartupErrorModal :open="api.showStartupErrorModal.value" :message="api.startupErrorMessage.value" />

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
    :open="api.openCheatsheet.value"
    :view="view"
    :panel-open="selection.isOpen.value"
    @close="api.closeCheatsheet"
  />

  <ManualMatchModal
    :open="api.showManualMatchModal.value"
    @close="api.closeManualMatch"
    @created="api.onManualMatchCreated"
  />

  <!-- First-launch tour overlay. Self-gates via localStorage. Steps drive the
       app via @navigate / @open-match / @open-narrow / @apply-hero-filter etc.;
       @active-change swaps in demo data so every step lands on something. -->
  <OnboardingTour
    :seed-and-switch-to-test="api.onTourSeedAndSwitch"
    @navigate="(v: string) => appStore.goToView(v as Parameters<typeof appStore.goToView>[0])"
    @active-change="api.onTourActiveChange"
    @open-match="(k: string) => selection.open(k)"
    @close-match="selection.close"
    @open-narrow="api.onTourOpenNarrow"
    @close-narrow="api.onTourCloseNarrow"
    @apply-hero-filter="api.onTourApplyHeroFilter"
    @clear-filters="api.onTourClearFilters"
  />

  <!-- First-run "Main account name" modal. Forced gate — every other surface
       is inert + aria-hidden while this is up. ESC + backdrop don't close it. -->
  <FirstRunProfileModal
    v-if="api.firstRunModalOpen.value"
    :platform="tesseractStatus?.platform ?? ''"
    :candidates="api.screenshotCandidates.value"
    :picking="api.probing.value"
    @dismiss="api.onFirstRunDismiss"
    @pick-source="api.onFirstRunPickSource"
    @pick-custom-source="api.onFirstRunPickCustomSource"
  />

  <!-- Export bundle modal — opens from the Matches bulk-action bar's
       "Export bundle…" button. -->
  <ExportBundleModal
    :open="api.exportBundleOpen.value"
    :selected-count="api.exportBundleSelectedKeys.value.length"
    :hidden-count="hiddenRecords.length"
    :unknown-count="unknownRecords.length"
    @close="api.closeExportBundle"
    @export="api.onExportBundleConfirm"
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

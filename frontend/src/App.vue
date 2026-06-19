<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
// App-wide styles — extracted from this SFC to keep App.vue navigable
// (~890 lines of template + script vs. ~4 600 lines when the 3 698-line
// <style> block was inline). Imported here rather than via main.ts so
// the dependency lives next to the component that anchors the cascade.
// Still globally scoped (matches the historical behaviour); component-
// specific selectors are tracked for a follow-up extraction into
// per-SFC scoped <style> blocks.
import '@/styles/app.css'

import { computed, defineAsyncComponent, type Component } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'
import { useExportBundle } from '@/composables/matches/useExportBundle'
import { useAnchorToast } from '@/composables/app/useAnchorToast'
import { useOnboardingTourBridge } from '@/composables/app/useOnboardingTourBridge'
import { useFirstRun } from '@/composables/app/useFirstRun'
import { useAppKeyboard } from '@/composables/app/useAppKeyboard'
import { useAppBoot } from '@/composables/app/useAppBoot'
import ParseStatusBar from '@/components/ingest/ParseStatusBar.vue'
import AppMasthead from '@/components/app/AppMasthead.vue'
import AppOverlays, { type OverlaysApi } from '@/components/app/AppOverlays.vue'
import SystemAlertBanner from '@/components/app/SystemAlertBanner.vue'
import ErrorBanner from '@/components/app/ErrorBanner.vue'
import MatchesSkeleton from '@/components/matches/shared/MatchesSkeleton.vue'
import UpdateReminderBanner from '@/components/shared/UpdateReminderBanner.vue'
import { useUpdateReminder } from '@/composables/shared/useUpdateReminder'

// The floating overlay cluster (modals, detail panel, lightbox, toasts, tour)
// lives in AppOverlays — it owns those lazy-loaded chunks now.

// View components are lazy-loaded via defineAsyncComponent so each
// becomes a separate JS chunk emitted by Vite. The initial bundle
// only ships the currently-visible view (Matches by default); the
// other three load on first tab click. Keeps initial JS small and
// makes the cost of adding a new view proportional to "is it
// visited" rather than "is it imported".
//
// `loadingComponent` + `delay: 220` shows a brief "Loading view…"
// fallback IF the chunk fetch + Vue mount takes longer than 220ms
// (the common case on throttled networks). On LAN / local the
// chunk lands before the delay elapses and the fallback never
// renders, keeping the snappy-feel intact.
import ViewLazyFallback from '@/components/shared/ViewLazyFallback.vue'
const VIEW_LAZY_DELAY = 220
function lazyView(loader: () => Promise<{ default: Component }>) {
  return defineAsyncComponent({
    loader,
    loadingComponent: ViewLazyFallback,
    delay: VIEW_LAZY_DELAY,
  })
}
const IngestView = lazyView(() => import('@/components/ingest/IngestView.vue'))
const MatchesView = lazyView(() => import('@/components/matches/MatchesView.vue'))
const SettingsView = lazyView(() => import('@/components/settings/SettingsView.vue'))
const UnknownMapsView = lazyView(() => import('@/components/unknown/UnknownMapsView.vue'))

// App-shell cross-cutting state (error banner, version, update check, data
// location) lives in the Pinia app store. Destructure with the same local
// names so the existing call sites in this file stay unchanged.
const appStore = useAppStore()
const {
  error,
  errorRetry,
  updateInfo,
} = storeToRefs(appStore)
const { setErrorFromRaw, clearError, checkForUpdates, goToView } = appStore
const { view } = storeToRefs(appStore)

// Matches domain: records (source of truth) + the derived triage lists live
// in the matches store. App's load() boot coordinator writes `records`;
// destructure with the same local names so this file's call sites are
// unchanged.
const matchesStore = useMatchesStore()
const {
  records,
  cancellingParse,
  firstLoadPending,
  parseProgress,
  parseLog,
  showUnsupportedModal,
  parseAnnouncement,
} = storeToRefs(matchesStore)
const {
  onTourActiveChange,
  onCancelParse,
} = matchesStore

// Onboarding-tour bridge: the @navigate/@open-narrow/@apply-hero-filter etc.
// handlers that drive the live surfaces per tour step (DOM + view nav).
const {
  onTourSeedAndSwitch,
  onTourOpenNarrow,
  onTourCloseNarrow,
  onTourApplyHeroFilter,
  onTourClearFilters,
} = useOnboardingTourBridge()

// All App-shell keyboard wiring — tablist Arrow/Home/End nav, the global
// shortcut registry (j/k, g-prefix, e/t, ?), the cheatsheet flag, and the
// search→panel auto-track — lives in useAppKeyboard.
const { focusMain, openCheatsheet } = useAppKeyboard()

// Detail-panel selection lives in the UI store (markRaw bundle).
const uiStore = useUiStore()


// Tesseract status (path / found / version / supported flag) + the
// "Browse for binary…" + "Reset to default" pickers + the System Alert
// CTA that deep-links into Settings → Engine.
const settingsStore = useSettingsStore()
const {
  tesseractStatus,
  tesseractReady,
  probing,
  screenshotCandidates,
} = storeToRefs(settingsStore)
const {
  gotoEngineSettings,
} = settingsStore

// Modal focus trap — captures the trigger, focuses the first
// focusable inside `.modal-box` (markup-first = Cancel button, never
// the destructive Continue Anyway), traps Tab/Shift+Tab, treats
// Escape as cancel, restores focus to the trigger on close.
useModalFocusTrap(showUnsupportedModal, { containerSelector: '.modal-box' })

// Boot coordinator: on mount it fans out into each domain store's loaders + owns
// the non-dismissible Startup-failure modal (open-state + focus trap).
const { showStartupErrorModal, startupErrorMessage } = useAppBoot()

// 90-day "haven't checked for updates in a while" reminder banner. Gated on
// updateInfo.last_checked_at (server-persisted) + a per-cycle dismissal; hidden
// while updateInfo is null so it doesn't flash false-positive on first paint.
const {
  shouldShowBanner: showUpdateReminder,
  daysSinceLastCheck: updateReminderDays,
  dismiss: dismissUpdateReminder,
} = useUpdateReminder(updateInfo)

// Export-bundle + CSV flow — the Matches bulk-action bar emits export-bundle /
// export-csv; useExportBundle owns the modal state + the ExportBundle /
// ExportMatchesCSV dispatch.
const {
  exportBundleOpen,
  exportBundleSelectedKeys,
  onExportBundleRequest,
  onExportMatchesCSV,
  onExportBundleConfirm,
} = useExportBundle({ onError: setErrorFromRaw })

// "Since this match" anchor confirmation toast — set/clear + the view-filter
// jump. The detail-panel selection bundle lives in the UI store.
const { anchorToast, onSetAnchor, onAnchorToastViewFilter, onAnchorToastDismiss } = useAnchorToast()
const selection = uiStore.selection

// First-run "name your main account" gate + its step-2 source-pick handlers
// live in useFirstRun; firstRunModalOpen feeds the background-freeze computed.
const {
  firstRunModalOpen,
  onFirstRunDismiss,
  onFirstRunPickSource,
  onFirstRunPickCustomSource,
} = useFirstRun()

// Every modal surface that should freeze the background — the masthead container
// + status bar flip `inert` + aria-hidden off this so screen readers + Tab nav
// don't bleed into the dimmed page. The narrow panel + manual-match flags live
// in the UI store; add to this list whenever you mount a new full-surface modal.
const backgroundFrozen = computed(() =>
  firstRunModalOpen.value
  || showUnsupportedModal.value
  || showStartupErrorModal.value
  || selection.isOpen.value
  || uiStore.narrowOpen
  || uiStore.manualMatchOpen,
)

// App-shell overlay bundle for AppOverlays — the composable-owned + App-local
// flags + the toast/tour handlers it can't read from a store on its own.
const overlaysApi: OverlaysApi = {
  anchorToast,
  onSetAnchor,
  onAnchorToastViewFilter,
  onAnchorToastDismiss,
  showStartupErrorModal,
  startupErrorMessage,
  openCheatsheet,
  closeCheatsheet: () => { openCheatsheet.value = false },
  firstRunModalOpen,
  screenshotCandidates,
  probing,
  onFirstRunDismiss,
  onFirstRunPickSource,
  onFirstRunPickCustomSource,
  exportBundleOpen,
  exportBundleSelectedKeys,
  closeExportBundle: () => { exportBundleOpen.value = false },
  onExportBundleConfirm,
  onTourSeedAndSwitch,
  onTourActiveChange,
  onTourOpenNarrow,
  onTourCloseNarrow,
  onTourApplyHeroFilter,
  onTourClearFilters,
}

// Subscribe to the watcher's parse-complete event so the records list
// auto-refreshes when an auto-parse runs in the background. Without
// this the user would have to click Parse manually to see new matches
// land in the UI even though the data is already in SQLite.

// Polite live-region announcement for the parse lifecycle. The
// ParseStatusBar already lights up an aria-live region during a
// run (counter + filename), but it goes inert when the bar hides
// at the end of the run — screen-reader users got no signal for
// "parse complete." Setting + clearing this ref drives an sr-only
// status region so the announcement fires once per terminal state.
// The ingest event stream (parse-complete/cancelled handlers + sr-only
// announce) + parse-recovery live in the matches store.
</script>

<template>
  <div class="app">
    <!-- Skip-link: first focusable on the page so keyboard users can
         bypass the masthead and nav tabs on every load. Visually hidden
         until focused, then snaps in over the top-left corner. -->
    <a class="skip-link" href="#main-content" @click="focusMain">Skip to main content</a>

    <!-- Polite parse-lifecycle announcer. Sets briefly on
         parse-complete + parse-cancelled, then clears so the next
         terminal state re-announces. Invisible to sighted users —
         the masthead chip + status bar carry the visual signal. -->
    <div class="sr-only" role="status" aria-live="polite">
      {{ parseAnnouncement }}
    </div>

    <div class="atmos" aria-hidden="true" />
    <div class="grid-lines" aria-hidden="true" />

    <div class="container" :inert="backgroundFrozen || undefined" :aria-hidden="backgroundFrozen ? 'true' : undefined">
      <!-- System Alert: blocks both Matches and Settings flow when the
           OCR engine isn't usable. Renders ABOVE the masthead so it's
           the first thing a user sees on a broken install. -->
      <SystemAlertBanner
        v-if="!tesseractReady"
        :path="tesseractStatus.path"
        :error="tesseractStatus.error"
        @fix="gotoEngineSettings"
      />

      <AppMasthead />

      <UpdateReminderBanner
        :open="showUpdateReminder"
        :days-since-last-check="updateReminderDays"
        @check="checkForUpdates"
        @dismiss="dismissUpdateReminder"
      />

      <ErrorBanner
        v-if="error"
        :message="error"
        :can-retry="!!errorRetry"
        @retry="errorRetry?.()"
        @dismiss="clearError"
      />

      <!-- <main> is the page's primary landmark. The skip-link at the
           top of .app jumps focus here so keyboard users can bypass the
           masthead and tablist on every load. tabindex="-1" lets us
           focus it programmatically without putting it in the natural
           tab order. -->
      <main id="main-content" tabindex="-1">
        <!-- ─── SETTINGS VIEW (folder + theme — minimal config) ──── -->
        <!-- Reads folders/engine/appearance/calendar + backup/clear/source-picker from the stores. -->
        <SettingsView v-if="view === 'settings'" />

        <!-- ─── PARSE VIEW (Watch + Manual Parse + Progress) ─────── -->
        <!-- Reads parse state from the matches store + Tesseract/watch from
             settings directly. -->
        <IngestView v-if="view === 'ingest'" />

        <!-- ─── UNKNOWN MAPS VIEW ────────────────────────────────── -->
        <!-- Reads its triage lists + card state + actions from the stores. -->
        <UnknownMapsView v-if="view === 'unknown'" />

        <!-- ─── MATCHES VIEW ───────────────────────────────────── -->
        <!-- First paint: render skeleton leaf-rows until the initial
             /api/v1/matches roundtrip lands. The skeleton mirrors the
             real .leaf-row grid so the page geometry doesn't shift. -->
        <MatchesSkeleton
          v-if="view === 'matches' && firstLoadPending && records.length === 0"
        />
        <!-- Reads records/narrow + selection + the mutations from the stores;
             App keeps the shell-coupled events (manual-match modal, narrow-open
             inert, the anchor toast, export-bundle/CSV flows). -->
        <MatchesView
          v-else-if="view === 'matches'"
          @export-bundle="onExportBundleRequest"
          @export-csv="onExportMatchesCSV"
          @clear-anchor="onSetAnchor('')"
          @set-anchor="onSetAnchor"
        />
      </main>
    </div>

    <!-- Persistent parse-status footer — visible from every tab while a
         parse is in flight; slides off-bottom 1.5 s after completion.
         Click anywhere on it to jump to the Ingest tab for the detailed
         log view. -->
    <ParseStatusBar
      :parse-progress="parseProgress"
      :parse-log="parseLog"
      :cancelling-parse="cancellingParse"
      :inert="backgroundFrozen || undefined"
      :aria-hidden="backgroundFrozen ? 'true' : undefined"
      @go-to-view="goToView"
      @cancel-parse="onCancelParse"
    />

    <!-- Floating overlay cluster — modals, the detail panel, lightbox, toasts,
         and the first-launch tour. AppOverlays reads its store-backed state
         directly; the App-shell-local flags (which App also needs for its
         background-freeze computed) + the DOM/view-nav handlers arrive as the
         `overlaysApi` bundle. -->
    <AppOverlays :api="overlaysApi" />
  </div>
</template>


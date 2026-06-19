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

import { defineAsyncComponent, type Component } from 'vue'
import { storeToRefs } from 'pinia'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'
import { useAppKeyboard } from '@/composables/app/useAppKeyboard'
import { useAppBoot } from '@/composables/app/useAppBoot'
import ParseStatusBar from '@/components/ingest/ParseStatusBar.vue'
import AppMasthead from '@/components/app/AppMasthead.vue'
import AppOverlays from '@/components/app/AppOverlays.vue'
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
const { clearError, checkForUpdates, goToView } = appStore
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
  onCancelParse,
} = matchesStore

// All App-shell keyboard wiring — tablist Arrow/Home/End nav, the global
// shortcut registry (j/k, g-prefix, e/t, ?), and the search→panel auto-track —
// lives in useAppKeyboard.
const { focusMain } = useAppKeyboard()

// The overlay cluster (modals, detail panel, toasts, tour, export/first-run)
// reads its state straight from the stores via AppOverlays now; App only needs
// the background-freeze getter for its own `inert` bindings.
const uiStore = useUiStore()
const { backgroundFrozen } = storeToRefs(uiStore)


// Tesseract status (path / found / version / supported flag) + the
// "Browse for binary…" + "Reset to default" pickers + the System Alert
// CTA that deep-links into Settings → Engine.
const settingsStore = useSettingsStore()
const {
  tesseractStatus,
  tesseractReady,
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
// the non-dismissible Startup-failure modal's focus trap (the gate state lives
// in the app store, read by AppOverlays).
useAppBoot()

// 90-day "haven't checked for updates in a while" reminder banner. Gated on
// updateInfo.last_checked_at (server-persisted) + a per-cycle dismissal; hidden
// while updateInfo is null so it doesn't flash false-positive on first paint.
const {
  shouldShowBanner: showUpdateReminder,
  daysSinceLastCheck: updateReminderDays,
  dismiss: dismissUpdateReminder,
} = useUpdateReminder(updateInfo)
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
        <!-- Reads records/narrow + selection + mutations + the export/anchor
             flows from the stores — zero props, zero emits. -->
        <MatchesView v-else-if="view === 'matches'" />
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
         and the first-launch tour. Reads all its state from the stores. -->
    <AppOverlays />
  </div>
</template>


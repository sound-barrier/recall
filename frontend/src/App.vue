<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
// App-wide styles — extracted from this SFC to keep App.vue navigable
// (~890 lines of template + script vs. ~4 600 lines when the 3 698-line
// <style> block was inline). Imported here rather than via main.ts so
// the dependency lives next to the component that anchors the cascade.
// Still globally scoped (matches the historical behavior); component-
// specific selectors are tracked for a follow-up extraction into
// per-SFC scoped <style> blocks.
import '@/styles/app.css'

import { storeToRefs } from 'pinia'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useParseStore } from '@/stores/parse'
import { useUiStore } from '@/stores/ui'
import { useModalFocusTrap } from '@/composables/shared/keyboard/useModalFocusTrap'
import { useAppKeyboard } from '@/composables/app/useAppKeyboard'
import { useAppBoot } from '@/composables/app/useAppBoot'
import { useServerEvents } from '@/composables/app/useServerEvents'
import ParseStatusBar from '@/components/ingest/ParseStatusBar.vue'
import AppMasthead from '@/components/app/AppMasthead.vue'
import AppOverlays from '@/components/app/AppOverlays.vue'
import SystemAlertBanner from '@/components/app/SystemAlertBanner.vue'
import ErrorBanner from '@/components/app/ErrorBanner.vue'
import NoticeBanner from '@/components/app/NoticeBanner.vue'
import MatchesSkeleton from '@/components/matches/shared/MatchesSkeleton.vue'
import UpdateReminderBanner from '@/components/update/UpdateReminderBanner.vue'
import CoachInboxBanner from '@/components/coach/inbox/CoachInboxBanner.vue'

// The floating overlay cluster (modals, detail panel, lightbox, toasts, tour)
// lives in AppOverlays — it owns those lazy-loaded chunks now.

// View components are lazy-loaded (lazyView → defineAsyncComponent) so
// each becomes a separate JS chunk emitted by Vite. The initial bundle
// only ships the currently-visible view (Matches by default); the
// others load on first tab click. Keeps initial JS small and makes
// the cost of adding a new view proportional to "is it visited"
// rather than "is it imported". The loading skeleton + failed-chunk
// reload affordance live in lazy-view.ts.
import { lazyView } from '@/components/app/lazy-view'
const IngestView = lazyView(() => import('@/components/ingest/IngestView.vue'))
const MatchesView = lazyView(() => import('@/components/matches/MatchesView.vue'))
const SettingsView = lazyView(() => import('@/components/settings/SettingsView.vue'))
const UnknownMapsView = lazyView(() => import('@/components/unknown/UnknownMapsView.vue'))
const SeasonCompareView = lazyView(() => import('@/components/compare/SeasonCompareView.vue'))
const EloCalculatorView = lazyView(() => import('@/components/elo/EloCalculatorView.vue'))
// Reviews hosts the film room while a session is open, and the shelf of
// reviews otherwise; the room is its own chunk inside that one.
const ReviewsView = lazyView(() => import('@/components/reviews/ReviewsView.vue'))

// App-shell cross-cutting state (error banner, version, update check, data
// location) lives in the Pinia app store. Destructure with the same local
// names so the existing call sites in this file stay unchanged.
const appStore = useAppStore()
const { view } = storeToRefs(appStore)

// Matches domain: the first-load skeleton gate and the records count for the
// skeleton. Parse domain: the unsupported-OCR modal gate (focus-trapped here)
// and the parse sr-only announcement. Everything else is read by the
// views/chrome that need it.
const { records, firstLoadPending } = storeToRefs(useMatchesStore())
const { showUnsupportedModal, parseAnnouncement } = storeToRefs(useParseStore())

// All App-shell keyboard wiring — tablist Arrow/Home/End nav, the global
// shortcut registry (j/k, g-prefix, e/t, ?), and the search→panel auto-track —
// lives in useAppKeyboard.
const { focusMain } = useAppKeyboard()

// The overlay cluster (modals, detail panel, toasts, tour, export/first-run)
// reads its state straight from the stores via AppOverlays now; App only needs
// the background-freeze getter for its own `inert` bindings.
const uiStore = useUiStore()
const { backgroundFrozen } = storeToRefs(uiStore)

// Modal focus trap — captures the trigger, focuses the first
// focusable inside `.modal-box` (markup-first = Cancel button, never
// the destructive Continue Anyway), traps Tab/Shift+Tab, treats
// Escape as cancel, restores focus to the trigger on close.
useModalFocusTrap(showUnsupportedModal, { containerSelector: '.modal-box' })

// Boot coordinator: on mount it fans out into each domain store's loaders + owns
// the non-dismissible Startup-failure modal's focus trap (the gate state lives
// in the app store, read by AppOverlays).
useAppBoot()
// Ingest event stream + parse-stream recovery — App-shell wiring because
// both register component lifecycle hooks; payloads land in the query
// cache / matches-store client refs.
useServerEvents()
</script>

<template>
  <div class="app">
    <!-- Skip-link: first focusable on the page so keyboard users can
         bypass the masthead and nav tabs on every load. Visually hidden
         until focused, then snaps in over the top-left corner. -->
    <a class="skip-link" href="#main-content" @click="focusMain">Skip to main content</a>

    <!-- Polite parse-lifecycle announcer. Sets briefly on
         parse-complete + parse-canceled, then clears so the next
         terminal state re-announces. Invisible to sighted users —
         the masthead chip + status bar carry the visual signal. -->
    <div class="sr-only" role="status" aria-live="polite">
      {{ parseAnnouncement }}
    </div>

    <div class="atmos" aria-hidden="true" />
    <div class="grid-lines" aria-hidden="true" />

    <!-- Failure announcement layer. Self-gates on a non-empty error and
         renders OUTSIDE the freezable container: an API failure while a
         modal is open must stay visible, announced (role=alert), and
         dismissible — inside .container it inherited inert + aria-hidden
         whenever backgroundFrozen flipped. -->
    <ErrorBanner />
    <NoticeBanner />

    <div class="container" :inert="backgroundFrozen || undefined" :aria-hidden="backgroundFrozen ? 'true' : undefined">
      <!-- Self-gates on a broken OCR install; renders above the masthead. -->
      <SystemAlertBanner />

      <AppMasthead />

      <!-- Self-gates on the 90-day overdue check (reads updateInfo itself). -->
      <UpdateReminderBanner />

      <!-- Coach notes waiting on a decision. Server-derived, so it survives a
           reload and a "Decide later" until every note has a verdict — and it
           lives in the chrome rather than on Matches, because a review that
           arrived is news on whatever tab the player happens to be reading.
           Self-gating, like every banner beside it — except on Reviews, whose
           shelf lists the same notes per coach with the same Review button;
           the banner above them would say it twice. -->
      <CoachInboxBanner v-if="view !== 'reviews'" />

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

        <!-- ─── SEASON COMPARE VIEW ──────────────────────────────── -->
        <!-- Reads the corpus + shared narrow off the matches store. -->
        <SeasonCompareView v-if="view === 'compare'" />

        <!-- ─── ELO CALCULATOR VIEW ──────────────────────────────── -->
        <EloCalculatorView v-if="view === 'elo'" />

        <!-- ─── REVIEWS VIEW (the shelf, or the film room) ────────── -->
        <!-- Hosts the coaching session's room while one is open, and the
             index of reviews otherwise. Reads the coach + returns stores. -->
        <ReviewsView v-if="view === 'reviews'" />

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

    <!-- Persistent parse-status footer — reads the parse lifecycle + the
         background-freeze from the stores + self-applies inert. -->
    <ParseStatusBar />

    <!-- Floating overlay cluster — modals, the detail panel, lightbox, toasts,
         and the first-launch tour. Reads all its state from the stores. -->
    <AppOverlays />
  </div>
</template>

